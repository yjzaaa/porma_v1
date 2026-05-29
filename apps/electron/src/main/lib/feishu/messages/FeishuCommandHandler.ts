/**
 * 飞书命令处理
 *
 * 处理 /help, /new, /chat, /agent, /list, /stop, /switch, /workspace, /now 命令。
 */
import type { FeishuMessageContext } from '@proma/shared'
import { getSettings } from '../../settings-service'
import {
  createAgentSession,
  listAgentSessions,
  getAgentSessionMeta,
} from '../../agent/agent-session-manager'
import {
  listAgentWorkspacesByUpdatedAt,
  getAgentWorkspace,
  getWorkspaceCapabilities,
} from '../../agent/agent-workspace-manager'
import { stopAgent } from '../../agent/agent-service'
import {
  buildHelpCard,
  buildSessionListCard,
  buildWorkspaceSwitchedCard,
  buildWorkspaceListCard,
  buildErrorCard,
} from '../feishu-message'
import type { WorkspaceListItem } from '../feishu-message'
import { readdirSync } from 'node:fs'

export interface BindingOperations {
  get(chatId: string): { workspaceId?: string; sessionId: string; mode?: string; chatType?: string; groupName?: string } | undefined
  set(chatId: string, binding: any): void
  remove(chatId: string): boolean
  clearSessionRef(sessionId: string): void
  saveBindings(): void
  get size(): number
}

export interface Sender {
  sendMessage(chatId: string, text: string): Promise<void>
  sendCardMessage(chatId: string, card: Record<string, unknown>): Promise<void>
}

export interface CardStreamer {
  markInterrupted(sessionId: string): void
}

export interface StatusUpdater {
  (partial: { activeBindings?: number }): void
}

export interface BotConfigSource {
  id: string
  name: string
  enabled: boolean
  appId: string
  appSecret: string
  defaultWorkspaceId?: string
  defaultChannelId?: string
  defaultModelId?: string
}

export class FeishuCommandHandler {
  constructor(
    private bindingOps: BindingOperations,
    private botConfig: BotConfigSource,
    private sender: Sender,
    private cardStreamer: CardStreamer,
    private updateStatus: StatusUpdater,
    private refreshBotConfig: (config: BotConfigSource) => void,
  ) {}

  async handle(msgCtx: FeishuMessageContext, text: string): Promise<void> {
    const { chatId } = msgCtx
    const [command, ...args] = text.split(/\s+/)
    const arg = args.join(' ').trim()

    switch (command?.toLowerCase()) {
      case '/help':
        await this.sender.sendCardMessage(chatId, buildHelpCard())
        break
      case '/new':
        await this.createNewSession(msgCtx, 'agent', arg || undefined)
        break
      case '/chat':
        await this.updateMode(msgCtx, 'chat')
        break
      case '/agent':
        await this.updateMode(msgCtx, 'agent')
        break
      case '/list':
        await this.handleList(msgCtx)
        break
      case '/stop':
        await this.handleStop(msgCtx)
        break
      case '/switch':
        if (!arg) {
          await this.sender.sendMessage(chatId, '用法: /switch <序号>（先用 /list 查看）')
          return
        }
        await this.handleSwitch(msgCtx, arg)
        break
      case '/workspace':
        await this.handleWorkspace(msgCtx, arg || undefined)
        break
      case '/now':
        await this.handleNow(msgCtx)
        break
      default:
        await this.sender.sendMessage(chatId, `未知命令: ${command}。输入 /help 查看帮助。`)
    }
  }

  async createNewSession(
    msgCtx: FeishuMessageContext,
    mode: 'agent' | 'chat',
    title?: string,
    overrideWorkspaceId?: string,
  ): Promise<void> {
    const { chatId } = msgCtx
    const appSettings = getSettings()

    let workspaceId =
      overrideWorkspaceId ??
      this.botConfig.defaultWorkspaceId ??
      appSettings.agentWorkspaceId
    if (!workspaceId) {
      const byTime = listAgentWorkspacesByUpdatedAt()
      const def = byTime.find((w) => w.slug === 'default')
      workspaceId = def?.id ?? byTime[0]?.id
    }
    if (!workspaceId) {
      await this.sender.sendMessage(chatId, '请先在 Proma 设置中创建工作区。')
      return
    }

    const channelId = this.botConfig.defaultChannelId ?? appSettings.agentChannelId
    if (!channelId) {
      await this.sender.sendMessage(chatId, '请先在 Proma Agent 设置中选择渠道。')
      return
    }

    const session = await createAgentSession(title, channelId, workspaceId)
    const binding = {
      chatId,
      botId: this.botConfig.id,
      userId: msgCtx.senderOpenId,
      sessionId: session.id,
      workspaceId,
      channelId,
      modelId: appSettings.agentModelId ?? undefined,
      mode,
      source: 'feishu',
      chatType: msgCtx.chatType,
      groupName: msgCtx.groupName,
      createdAt: Date.now(),
    }
    this.bindingOps.set(chatId, binding)
    this.updateStatus({ activeBindings: this.bindingOps.size })
    this.bindingOps.saveBindings()

    const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
    await this.sender.sendMessage(chatId, `已创建 ${modeLabel} 会话 (${session.id.slice(0, 8)})`)
  }

  private async updateMode(
    msgCtx: FeishuMessageContext,
    mode: 'agent' | 'chat',
  ): Promise<void> {
    const { chatId } = msgCtx
    const binding = this.bindingOps.get(chatId)
    if (binding) {
      ;(binding as any).mode = mode
      await this.sender.sendMessage(chatId, `已切换到 ${mode === 'agent' ? 'Agent' : 'Chat'} 模式`)
    } else {
      await this.sender.sendMessage(
        chatId,
        `当前没有会话。直接发送消息将自动创建 ${mode === 'agent' ? 'Agent' : 'Chat'} 会话，或使用 /new 创建。`,
      )
    }
  }

  private async handleList(msgCtx: FeishuMessageContext): Promise<void> {
    const { chatId } = msgCtx
    const sessions = listAgentSessions()
    const workspaces = listAgentWorkspacesByUpdatedAt()
    const binding = this.bindingOps.get(chatId)
    const currentWorkspaceId = binding?.workspaceId
    const MAX_SESSIONS_PER_WS = 5

    const sessionIndexMap = new Map<string, number>()
    sessions.forEach((s, i) => sessionIndexMap.set(s.id, i + 1))

    const wsItems: WorkspaceListItem[] = workspaces.map((ws) => {
      const wsSessions = sessions
        .filter((s) => s.workspaceId === ws.id)
        .slice(0, MAX_SESSIONS_PER_WS)
        .map((s) => ({
          id: s.id,
          title: s.title,
          active: binding?.sessionId === s.id,
          index: sessionIndexMap.get(s.id) ?? 0,
        }))
      return { id: ws.id, name: ws.name, sessions: wsSessions }
    })

    const orphanSessions = sessions
      .filter((s) => !s.workspaceId || !workspaces.some((w) => w.id === s.workspaceId))
      .slice(0, MAX_SESSIONS_PER_WS)
      .map((s) => ({
        id: s.id,
        title: s.title,
        active: binding?.sessionId === s.id,
        index: sessionIndexMap.get(s.id) ?? 0,
      }))
    if (orphanSessions.length > 0) {
      wsItems.push({ id: '', name: '未分配工作区', sessions: orphanSessions })
    }

    await this.sender.sendCardMessage(chatId, buildSessionListCard(wsItems, currentWorkspaceId))
  }

  private async handleStop(msgCtx: FeishuMessageContext): Promise<void> {
    const { chatId } = msgCtx
    const binding = this.bindingOps.get(chatId)
    if (!binding) {
      await this.sender.sendMessage(chatId, '当前没有绑定的会话。')
      return
    }
    stopAgent(binding.sessionId)
    this.cardStreamer.markInterrupted(binding.sessionId)
    await this.sender.sendMessage(chatId, '已停止 Agent')
  }

  private async handleSwitch(msgCtx: FeishuMessageContext, arg: string): Promise<void> {
    const { chatId } = msgCtx
    const sessions = listAgentSessions()

    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= sessions.length
      ? sessions[index - 1]
      : sessions.find((s) => s.id.startsWith(arg))

    if (!match) {
      await this.sender.sendMessage(chatId, '未找到会话。使用 /list 查看可用会话。')
      return
    }

    const oldBinding = this.bindingOps.get(chatId)
    if (oldBinding) {
      this.bindingOps.clearSessionRef(oldBinding.sessionId)
    }

    const appSettings = getSettings()
    const binding: any = {
      chatId,
      botId: this.botConfig.id,
      userId: msgCtx.senderOpenId,
      sessionId: match.id,
      workspaceId: match.workspaceId ?? this.botConfig.defaultWorkspaceId ?? appSettings.agentWorkspaceId ?? '',
      channelId: match.channelId ?? appSettings.agentChannelId ?? '',
      modelId: appSettings.agentModelId ?? undefined,
      mode: 'agent',
      source: 'feishu',
      chatType: msgCtx.chatType,
      groupName: msgCtx.groupName,
      createdAt: Date.now(),
    }
    this.bindingOps.set(chatId, binding)
    this.updateStatus({ activeBindings: this.bindingOps.size })
    this.bindingOps.saveBindings()

    await this.sender.sendMessage(chatId, `已切换到会话: ${match.title} (${match.id.slice(0, 8)})`)
  }

  private async handleWorkspace(
    msgCtx: FeishuMessageContext,
    arg?: string,
  ): Promise<void> {
    const { chatId } = msgCtx
    const workspaces = listAgentWorkspacesByUpdatedAt()
    const binding = this.bindingOps.get(chatId)
    const currentWorkspaceId = binding?.workspaceId

    if (!arg) {
      const items = workspaces.map((w, i) => ({
        index: i + 1,
        name: w.name,
        isCurrent: w.id === currentWorkspaceId,
      }))
      await this.sender.sendCardMessage(chatId, buildWorkspaceListCard(items))
      return
    }

    const index = Number(arg)
    const match =
      Number.isInteger(index) && index >= 1 && index <= workspaces.length
        ? workspaces[index - 1]
        : workspaces.find(
            (w) => w.name.toLowerCase() === arg.toLowerCase() || w.slug === arg.toLowerCase(),
          )

    if (!match) {
      const available = workspaces.map((w, i) => `${i + 1}. ${w.name}`).join(', ')
      await this.sender.sendMessage(chatId, `未找到工作区 "${arg}"。可用: ${available}`)
      return
    }

    if (binding) {
      this.bindingOps.clearSessionRef(binding.sessionId)
      this.bindingOps.remove(chatId)
      this.updateStatus({ activeBindings: this.bindingOps.size })
      this.bindingOps.saveBindings()
    }

    // 更新 Bot 配置
    this.refreshBotConfig({
      ...this.botConfig,
      defaultWorkspaceId: match.id,
    })

    const sessions = listAgentSessions()
    const recentSessions = sessions
      .filter((s) => s.workspaceId === match.id)
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        title: s.title,
        index: sessions.indexOf(s) + 1,
      }))

    await this.sender.sendCardMessage(chatId, buildWorkspaceSwitchedCard(match.name, recentSessions))
  }

  private async handleNow(msgCtx: FeishuMessageContext): Promise<void> {
    const { chatId } = msgCtx
    const binding = this.bindingOps.get(chatId)
    const lines: string[] = []

    if (binding) {
      const session = getAgentSessionMeta(binding.sessionId)
      lines.push(`**会话**: ${session?.title ?? '未知'} (\`${binding.sessionId.slice(0, 8)}\`)`)
      lines.push(`**模式**: ${binding.mode === 'agent' ? 'Agent' : 'Chat'}`)
    } else {
      lines.push('**会话**: 未绑定（发送消息将自动创建）')
    }

    const workspaceId = binding?.workspaceId
    const workspace = workspaceId ? getAgentWorkspace(workspaceId) : undefined
    if (workspace) {
      lines.push(`**工作区**: ${workspace.name} (\`${workspace.slug}\`)`)
      const capabilities = getWorkspaceCapabilities(workspace.slug)
      if (capabilities.mcpServers.length > 0) {
        lines.push('')
        lines.push('**MCP Servers**:')
        for (const mcp of capabilities.mcpServers) {
          lines.push(`  ${mcp.enabled !== false ? '启用' : '停用'} ${mcp.name}`)
        }
      } else {
        lines.push('**MCP Servers**: 无')
      }
      if (capabilities.skills.length > 0) {
        lines.push('')
        lines.push('**Skills**:')
        for (const skill of capabilities.skills) {
          lines.push(`  ${skill.enabled !== false ? '启用' : '停用'} ${skill.name}`)
        }
      } else {
        lines.push('**Skills**: 无')
      }
      // 工作区文件列表
      try {
        const { getAgentWorkspacePath } = await import('../../config-paths')
        const wsPath = getAgentWorkspacePath(workspace.slug)
        const entries = readdirSync(wsPath, { withFileTypes: true })
        const fileList = entries
          .filter((e) => !e.name.startsWith('.') && e.name !== 'mcp.json' && e.name !== 'config.json' && e.name !== 'skills' && e.name !== 'skills-inactive')
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        if (fileList.length > 0) {
          lines.push('')
          lines.push('**工作区文件**:')
          for (const f of fileList.slice(0, 20)) lines.push(`  ${f}`)
          if (fileList.length > 20) lines.push(`  ... 还有 ${fileList.length - 20} 项`)
        }
      } catch {
        // 忽略
      }
    } else {
      lines.push('**工作区**: 未设置')
    }

    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '当前状态' },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: lines.join('\n') },
      ],
    }
    await this.sender.sendCardMessage(chatId, card)
  }
}
