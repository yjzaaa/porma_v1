/**
 * Session Mirror：桌面发起的会话同步为飞书群内流式卡片
 */
import type { AgentSessionMeta, FeishuChatBinding } from '@proma/shared'
import { BrowserWindow } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import { getSettings } from '../../storage/settings-service'
import { buildSessionMirrorGroupName } from '../session-mirror'
import { getAgentSessionMeta } from '../../agent/agent-session-manager'

export interface BindingProvider {
  findBySessionId(sessionId: string): FeishuChatBinding | undefined
  get(chatId: string): FeishuChatBinding | undefined
  set(chatId: string, binding: FeishuChatBinding): void
  saveBindings(): void
  getLastInteractedUserOpenId(): string | null
  get size(): number
}

export interface ConnectionProvider {
  client: InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null
}

export class FeishuSessionMirror {
  constructor(
    private botConfig: { id: string; defaultWorkspaceId?: string; defaultChannelId?: string; defaultModelId?: string },
    private bindings: BindingProvider,
    private connection: ConnectionProvider,
  ) {}

  /**
   * 为桌面端会话准备飞书镜像群
   */
  async ensure(session: AgentSessionMeta): Promise<void> {
    if (!this.connection.client) return

    const existing = this.bindings.findBySessionId(session.id)
    if (existing) return

    const userOpenId = this.bindings.getLastInteractedUserOpenId()
    if (!userOpenId) {
      console.warn('[飞书 Session 镜像] 缺少用户 open_id，无法创建镜像群')
      return
    }

    const appSettings = getSettings()
    const workspaceId =
      session.workspaceId ??
      this.botConfig.defaultWorkspaceId ??
      appSettings.agentWorkspaceId
    const channelId =
      session.channelId ??
      this.botConfig.defaultChannelId ??
      appSettings.agentChannelId
    if (!workspaceId || !channelId) {
      console.warn('[飞书 Session 镜像] 缺少 workspaceId 或 channelId')
      return
    }

    const groupName = buildSessionMirrorGroupName(session)
    const chatId = await this.createGroup(userOpenId, groupName)
    if (!chatId) return

    const binding: FeishuChatBinding = {
      chatId,
      botId: this.botConfig.id,
      userId: userOpenId,
      sessionId: session.id,
      workspaceId,
      channelId,
      modelId: this.botConfig.defaultModelId ?? appSettings.agentModelId ?? undefined,
      mode: 'agent',
      source: 'session-mirror',
      chatType: 'group',
      groupName,
      createdAt: Date.now(),
    }

    this.bindings.set(chatId, binding)
    this.bindings.saveBindings()
  }

  /**
   * 更新镜像群名称（标题变更时）
   */
  updateGroupName(sessionId: string, title: string): void {
    const binding = this.bindings.findBySessionId(sessionId)
    if (!binding || binding.source !== 'session-mirror') return

    const nextName = buildSessionMirrorGroupName({ id: sessionId, title })
    if (binding.groupName === nextName) return

    void this.renameGroup(binding.chatId, nextName)
      .then((updated) => {
        if (!updated) return
        binding.groupName = nextName
        this.bindings.saveBindings()
      })
      .catch((error) => {
        console.error('[飞书 Session 镜像] 更新群名失败:', error)
      })
  }

  /** 通知渲染进程刷新会话列表 */
  notifySessionUpdate(sessionId: string, title: string): void {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
        sessionId,
        title,
      })
    }
  }

  // ===== 私有 =====

  private async createGroup(userOpenId: string, name: string): Promise<string | null> {
    if (!this.connection.client) return null

    try {
      const resp = await this.connection.client.im.chat.create({
        data: {
          name,
          chat_mode: 'group',
          chat_type: 'private',
          user_id_list: [userOpenId],
        },
        params: { user_id_type: 'open_id' },
      })

      if (resp.code && resp.code !== 0) {
        console.error('[飞书 Session 镜像] 创建群失败:', resp.code, resp.msg)
        return null
      }

      const chatId = resp.data?.chat_id
      if (!chatId) {
        console.error('[飞书 Session 镜像] 未返回 chat_id')
        return null
      }
      return chatId
    } catch (error) {
      console.error('[飞书 Session 镜像] 创建群异常:', error)
      return null
    }
  }

  private async renameGroup(chatId: string, name: string): Promise<boolean> {
    if (!this.connection.client) return false

    try {
      const resp = await this.connection.client.im.chat.update({
        path: { chat_id: chatId },
        data: { name },
      })
      if (resp.code && resp.code !== 0) {
        console.warn('[飞书 Session 镜像] 更新群名返回非 0 code:', resp.code, resp.msg)
        return false
      }
      return true
    } catch (error) {
      console.error('[飞书 Session 镜像] 调用更新群名接口失败:', error)
      return false
    }
  }
}
