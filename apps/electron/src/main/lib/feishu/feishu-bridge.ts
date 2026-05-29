/**
 * 飞书 Bridge 服务 — Mediator 协调器
 *
 * 核心职责：
 * - 协调 9 个子模块完成消息接收、路由、Agent 调用和飞书回复
 * - 提供统一公共接口给 FeishuBridgeManager
 */
import type {
  FeishuBridgeState,
  FeishuChatBinding,
  FeishuTestResult,
  FeishuUpdateBindingInput,
  FeishuBotConfig,
  AgentSessionMeta,
  AgentStreamPayload,
  SDKAssistantMessage,
  AgentSendInput,
  FeishuMessageContext,
} from '@proma/shared'
import { FEISHU_IPC_CHANNELS } from '@proma/shared'
import { agentEventBus, runAgentHeadless } from '../agent/agent-service'
import { getSettings } from '../settings-service'

// 子模块
import { FeishuConnection } from './connection/FeishuConnection'
import { FeishuBindingRepository } from './bindings/FeishuBindingRepository'
import { FeishuSender } from './FeishuSender'
import { FeishuMessageDedup, MESSAGE_DEBOUNCE_MS } from './messages/FeishuMessageDedup'
import { FeishuAttachmentDownload } from './messages/FeishuAttachmentDownload'
import { FeishuMessageRouter } from './messages/FeishuMessageRouter'
import { FeishuCommandHandler } from './messages/FeishuCommandHandler'
import { FeishuCardStreamer } from './streaming/FeishuCardStreamer'
import { FeishuSessionMirror } from './streaming/FeishuSessionMirror'
import { FeishuGroupService } from './group/FeishuGroupService'
import { FeishuHistoryFetcher } from './history/FeishuHistoryFetcher'
import { FeishuMcpProvider } from './mcp/FeishuMcpProvider'
import { resolveContextPrefix, resolveContextSubtitle } from './context'
import { buildAgentReplyCard, buildErrorCard, splitLongContent, accumulateToolStart } from './feishu-message'
import type { FormattedAgentResult } from './feishu-message'
import { buildSessionMirrorGroupName } from './session-mirror'
import { buildAgentUserMessage, fetchQuotedMessage } from './prompt-builder'
import type { BridgeContext, QuotedMessage } from './prompt-builder'
import { RunCoordinator } from './run-coordinator'

// ===== 类型定义 =====

/** 会话累积缓冲 */
interface SessionBuffer {
  text: string
  toolSummaries: Map<string, ToolSummary>
  startedAt: number
}

interface QueuedFeishuMessage {
  msgCtx: import('@proma/shared').FeishuMessageContext
  text: string
  imageAttachments: import('./feishu/types').FeishuImageAttachment[]
  fileAttachments: import('./feishu/types').FeishuFileAttachment[]
  parentMessageId?: string
}

const MAX_CONCURRENT_RUNS = 3

// ===== Mediator =====

class FeishuBridge {
  /** Bot 配置 */
  private botConfig: FeishuBotConfig

  // 子模块
  private connection!: FeishuConnection
  private bindings!: FeishuBindingRepository
  private sender!: FeishuSender
  private dedup!: FeishuMessageDedup
  private attachmentDownload!: FeishuAttachmentDownload
  private commandHandler!: FeishuCommandHandler
  private router!: FeishuMessageRouter
  private cardStreamer!: FeishuCardStreamer
  private sessionMirror!: FeishuSessionMirror
  private groupService!: FeishuGroupService
  private historyFetcher!: FeishuHistoryFetcher
  private mcpProvider!: FeishuMcpProvider

  /** 会话累积缓冲（桌面通知 + 降级回复路径） */
  private sessionBuffers = new Map<string, SessionBuffer>()
  /** 防抖队列 batch flush */
  private runCoordinator!: RunCoordinator

  /** EventBus 取消函数 */
  private eventBusUnsubscribe: (() => void) | null = null

  constructor(botConfig: FeishuBotConfig) {
    this.botConfig = botConfig
    this.initializeModules()
  }

  /** 初始化或重新初始化子模块 */
  private initializeModules(): void {
    const botConfig = this.botConfig

    // Connection
    this.connection = new FeishuConnection()

    // Binding Repository
    this.bindings = new FeishuBindingRepository(botConfig.id)

    // Group Service
    this.groupService = new FeishuGroupService(
      () => this.connection.client,
      () => this.connection.botOpenId,
    )

    // History Fetcher
    this.historyFetcher = new FeishuHistoryFetcher(
      () => this.connection.client,
      (openId) => this.groupService.getUserName(openId),
    )

    // MCP Provider
    this.mcpProvider = new FeishuMcpProvider(this.historyFetcher)

    // Sender
    this.sender = new FeishuSender({
      client: null,
      getBinding: (chatId) => this.bindings.get(chatId),
      getLastUserMessageId: () => undefined,
      trackSentMessage: (messageId) => this.dedup?.trackSentMessage(messageId),
    })

    // Attachment Download
    this.attachmentDownload = new FeishuAttachmentDownload(
      () => this.connection.client,
    )

    // Card Streamer
    this.cardStreamer = new FeishuCardStreamer(
      () => this.connection.client,
      (chatId) => resolveContextPrefix(chatId, (cid) => this.bindings.get(cid)),
      (sessionId) => this.bindings.getChatIdBySessionId(sessionId),
    )

    // Session Mirror
    this.sessionMirror = new FeishuSessionMirror(
      botConfig,
      this.bindings,
      this.connection,
    )

    // Command Handler
    this.commandHandler = new FeishuCommandHandler(
      this.bindings,
      botConfig,
      this.sender,
      this.cardStreamer,
      (partial) => this.updateStatus(partial),
      (config) => {
        this.botConfig = { ...this.botConfig, ...config }
      },
    )

    // 防抖队列
    this.runCoordinator = new RunCoordinator(MAX_CONCURRENT_RUNS)

    // 消息去重
    this.dedup = new FeishuMessageDedup(MESSAGE_DEBOUNCE_MS, (scope, batch) => {
      this.flushMessageBatch(scope, batch)
    })

    // Router
    this.router = new FeishuMessageRouter(
      this.bindings,
      this.dedup,
      this.attachmentDownload,
      this.commandHandler,
      this.groupService,
      botConfig,
      this.sender,
      (partial) => this.updateStatus(partial),
      () => this.connection.client,
      () => this.connection.botOpenId,
      async (sessionId, chatId, headerTitle) =>
        this.cardStreamer.startStream(sessionId, chatId, headerTitle),
      async (input) => this.runAgent(input),
    )
  }

  // ===== 公共接口 =====

  getBotConfig(): FeishuBotConfig {
    return this.botConfig
  }

  async start(): Promise<void> {
    if (!this.botConfig.appId || !this.botConfig.appSecret) {
      throw new Error('请先配置 App ID 和 App Secret')
    }

    this.updateStatus({ status: 'connecting' })

    try {
      // 连接 WebSocket
      await this.connection.start(this.botConfig)
      this.sender = new FeishuSender({
        client: this.connection.client,
        getBinding: (chatId) => this.bindings.get(chatId),
        getLastUserMessageId: (chatId) => undefined,
        trackSentMessage: (messageId) => this.dedup.trackSentMessage(messageId),
      })

      // 连接成功后，更新 router 的 sender 引用
      this.router.setSender(this.sender)

      // 注册消息路由
      this.connection.onMessage((data) => {
        this.router.handle(data).catch((error) => {
          console.error('[飞书 Bridge] 处理消息异常:', error)
        })
      })

      // 注册 EventBus 监听
      this.eventBusUnsubscribe = agentEventBus.on((sessionId, payload) => {
        this.handleAgentPayload(sessionId, payload)
      })

      // 恢复持久化数据
      this.bindings.load()

      this.updateStatus({
        status: 'connected',
        connectedAt: Date.now(),
        activeBindings: this.bindings.size,
      })
      console.log('[飞书 Bridge] 已连接')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStatus({ status: 'error', errorMessage: message })
      console.error('[飞书 Bridge] 启动失败:', error)
    }
  }

  stop(): void {
    this.eventBusUnsubscribe?.()
    this.eventBusUnsubscribe = null

    this.connection.disconnect()
    this.bindings.clear()
    this.dedup.clear()
    this.cardStreamer.clear()
    this.groupService.clear()
    this.sessionBuffers.clear()
    this.runCoordinator?.abortAll()

    this.updateStatus({ status: 'disconnected', activeBindings: 0 })
    console.log('[飞书 Bridge] 已停止')
  }

  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  getStatus(): FeishuBridgeState {
    return this.connection.status
  }

  listBindings(): FeishuChatBinding[] {
    return this.bindings.list()
  }

  updateBinding(input: FeishuUpdateBindingInput): FeishuChatBinding | null {
    const result = this.bindings.update(input)
    if (result) this.bindings.saveBindings()
    return result
  }

  removeBinding(chatId: string): boolean {
    const binding = this.bindings.get(chatId)
    const result = this.bindings.remove(chatId)
    if (result && binding) {
      this.cardStreamer.clearSession(binding.sessionId)
      this.updateStatus({ activeBindings: this.bindings.size })
      this.bindings.saveBindings()
    }
    return result
  }

  async ensureSessionMirror(session: AgentSessionMeta): Promise<void> {
    await this.sessionMirror.ensure(session)
  }

  async startSessionMirrorRun(session: AgentSessionMeta): Promise<void> {
    const client = this.connection.client
    if (!client) return
    await this.sessionMirror.ensure(session)

    const binding = this.bindings.findBySessionId(session.id)
    if (!binding || binding.source !== 'session-mirror') return
    if (this.cardStreamer.hasCard(session.id)) return

    const header = binding.groupName ?? buildSessionMirrorGroupName(session)
    const ok = await this.cardStreamer.startMirrorStream(
      session.id,
      binding.chatId,
      `${header} · Agent 处理中`,
    )
    if (ok) {
      this.sender.clearLastUserMessageId(binding.chatId)
    }
  }

  stopSessionMirrorRun(sessionId: string): void {
    this.cardStreamer.markInterrupted(sessionId)
  }

  async testConnection(appId: string, appSecret: string): Promise<FeishuTestResult> {
    try {
      const lark = await import('@larksuiteoapi/node-sdk')
      const client = new lark.Client({
        appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
      })

      const resp = await client.auth.tenantAccessToken.internal({
        data: { app_id: appId, app_secret: appSecret },
      })

      if (resp.code === 0) {
        return {
          success: true,
          message: '连接成功',
          botName: `App ${appId.slice(0, 8)}...`,
        }
      }
      return {
        success: false,
        message: `飞书 API 错误: ${resp.msg ?? '未知错误'} (code: ${resp.code})`,
      }
    } catch (error) {
      return {
        success: false,
        message: `连接失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // ===== EventBus 事件处理 =====

  private handleAgentPayload(sessionId: string, payload: AgentStreamPayload): void {
    // 流式卡片更新
    this.cardStreamer.handlePayload(sessionId, payload)

    const buffer = this.sessionBuffers.get(sessionId)

    // 累积文本 + 工具摘要
    if (buffer && payload.kind === 'sdk_message') {
      const msg = payload.message
      if (msg.type === 'assistant') {
        const aMsg = msg as SDKAssistantMessage
        for (const block of aMsg.message?.content ?? []) {
          if (block.type === 'text') {
            const text = (block as { text?: unknown }).text
            if (typeof text === 'string') buffer.text += text
          } else if (block.type === 'tool_use') {
            const tb = block as { name?: unknown }
            if (typeof tb.name === 'string') {
              accumulateToolStart(buffer.toolSummaries, tb.name)
            }
          }
        }
      }
    }

    // result 处理
    if (payload.kind === 'sdk_message' && payload.message.type === 'result') {
      if (buffer) {
        this.handleSessionComplete(sessionId)
      } else if (this.cardStreamer.isTerminalHandled(sessionId)) {
        this.cardStreamer.clearTerminalHandled(sessionId)
      } else if (this.cardStreamer.hasUsedCard(sessionId)) {
        this.cardStreamer.clearUsedSession(sessionId)
      }
      return
    }

    // SDK assistant 错误帧
    if (payload.kind === 'sdk_message' && payload.message.type === 'assistant') {
      const aMsg = payload.message as SDKAssistantMessage
      if (aMsg.error?.message) {
        const chatId = this.bindings.getChatIdBySessionId(sessionId)
        if (chatId && !this.cardStreamer.hasUsedCard(sessionId)) {
          const prefix = resolveContextPrefix(chatId, (cid) => this.bindings.get(cid))
          this.sender
            .sendCardMessage(chatId, buildErrorCard(`${prefix}${aMsg.error.message}`))
            .catch(console.error)
        }
        this.sessionBuffers.delete(sessionId)
        this.cardStreamer.markError(sessionId, aMsg.error.message)
      }
    }

    // 标题更新 → Session Mirror 群名更新
    if (payload.kind === 'proma_event' && payload.event.type === 'title_updated') {
      this.sessionMirror.updateGroupName(sessionId, payload.event.title)
    }
  }

  // ===== 批量消息处理 =====

  private flushMessageBatch(scope: string, batch: QueuedFeishuMessage[]): void {
    if (batch.length === 0) return
    void this.runMergedBatch(scope, batch).catch((error) => {
      console.error('[飞书 Bridge] flushMessageBatch 异常', { scope, err: error })
    })
  }

  private async runMergedBatch(scope: string, batch: QueuedFeishuMessage[]): Promise<void> {
    const first = batch[0]!
    const last = batch[batch.length - 1]!

    const mergedText = batch
      .map((m) => m.text.trim())
      .filter((t) => t.length > 0)
      .join('\n\n')
    const mergedImages = batch.flatMap((m) => m.imageAttachments)
    const mergedFiles = batch.flatMap((m) => m.fileAttachments)
    const parentMessageId = [...batch].reverse().find((m) => m.parentMessageId)?.parentMessageId
    const msgCtx = { ...last.msgCtx }

    const release = await this.runCoordinator.acquire(scope, first.msgCtx.chatId)
    this.dedup.messageQueue.block(scope)
    try {
      await this.handleUserMessage(msgCtx, mergedText, mergedImages, mergedFiles, parentMessageId)
    } finally {
      release()
      this.dedup.messageQueue.unblock(scope)
    }
  }

  // ===== 用户消息处理 =====

  private async handleUserMessage(
    msgCtx: import('@proma/shared').FeishuMessageContext,
    text: string,
    imageAttachments: import('./feishu/types').FeishuImageAttachment[] = [],
    fileAttachments: import('./feishu/types').FeishuFileAttachment[] = [],
    parentMessageId?: string,
  ): Promise<void> {
    const { chatId } = msgCtx
    let binding = this.bindings.get(chatId)

    // 自动创建会话
    if (!binding) {
      await this.createNewSession(msgCtx, 'agent')
      binding = this.bindings.get(chatId)
      if (!binding) return
    }

    // 保存附件到 session
    const fileReferences = await this.router.saveAttachments(
      binding.sessionId,
      binding.workspaceId,
      imageAttachments,
      fileAttachments,
    )

    // 初始化缓冲
    this.sessionBuffers.set(binding.sessionId, {
      text: '',
      toolSummaries: new Map(),
      startedAt: Date.now(),
    })

    // 初始化流式卡片
    const prefix = resolveContextPrefix(chatId, (cid) => this.bindings.get(cid))
    const headerTitle = prefix ? `${prefix.trim()} · Agent 处理中` : 'Agent 处理中'
    const ok = await this.cardStreamer.startStream(
      binding.sessionId,
      chatId,
      headerTitle,
      '发送 `/stop` 可终止当前任务',
      msgCtx.chatType === 'group' ? msgCtx.messageId : undefined,
    )
    if (!ok) {
      await this.sender.sendMessage(chatId, `${prefix}Agent 处理中...`)
    }

    if (binding.mode === 'agent') {
      const hasAttachment = imageAttachments.length > 0 || fileAttachments.length > 0
      const userText = text || (hasAttachment ? '请查看上面附加的文件。' : '')

      // 拉取引用消息
      let quoted: QuotedMessage | undefined
      if (parentMessageId && this.connection.client) {
        quoted = await fetchQuotedMessage(this.connection.client, parentMessageId)
      }

      // 群聊上下文
      let groupExtraBlock: string | undefined
      if (msgCtx.chatType === 'group') {
        const contextParts: string[] = []
        if (msgCtx.groupName) contextParts.push(`[群聊: ${msgCtx.groupName}]`)
        if (msgCtx.senderName) contextParts.push(`[发送者: ${msgCtx.senderName}]`)

        const groupInfo = await this.groupService.getGroupInfo(chatId)
        if (groupInfo?.members && groupInfo.members.length > 0) {
          const membersExceptBot = groupInfo.members.filter(
            (m) => m.openId !== this.connection.botOpenId,
          )
          const memberList = membersExceptBot.map((m) => `${m.name}(${m.openId})`).join(', ')
          contextParts.push(`[群成员: ${memberList}]`)
          contextParts.push('[提示: 如需 @某人，请直接使用 @姓名 格式]')
        }

        const chatHistory = await this.historyFetcher.fetch(chatId)
        const historyContext = this.historyFetcher.formatContext(chatHistory)

        const parts: string[] = []
        if (contextParts.length > 0) parts.push(contextParts.join(' '))
        if (historyContext) parts.push(historyContext)
        groupExtraBlock = parts.length > 0 ? parts.join('\n') : undefined
      }

      const bridgeContext: BridgeContext = {
        chatId: msgCtx.chatId,
        chatType: msgCtx.chatType,
        senderOpenId: msgCtx.senderOpenId,
        senderName: msgCtx.senderName,
      }

      const agentMessage = buildAgentUserMessage({
        userText,
        context: bridgeContext,
        quoted,
        attachedFilesBlock: fileReferences.trim() || undefined,
        groupExtraBlock,
      })

      // 群聊时注入 MCP 工具
      let customMcpServers: Record<string, Record<string, unknown>> | undefined
      if (msgCtx.chatType === 'group') {
        const mcpServer = await this.mcpProvider.createServer(chatId)
        if (mcpServer) {
          customMcpServers = { feishu_chat: mcpServer as unknown as Record<string, unknown> }
        }
      }

      const latestSettings = getSettings()
      const channelId =
        this.botConfig.defaultChannelId || latestSettings.agentChannelId || binding.channelId
      const modelId =
        this.botConfig.defaultModelId || latestSettings.agentModelId || binding.modelId

      const input: AgentSendInput = {
        sessionId: binding.sessionId,
        userMessage: agentMessage,
        channelId,
        modelId,
        workspaceId: binding.workspaceId,
        permissionModeOverride: 'bypassPermissions',
        ...(customMcpServers && { customMcpServers }),
      }

      try {
        await runAgentHeadless(input, {
          source: 'feishu',
          onError: (error) => {
            const errPrefix = resolveContextPrefix(chatId, (cid) => this.bindings.get(cid))
            if (this.cardStreamer.hasCard(binding!.sessionId)) {
              this.cardStreamer.markError(binding!.sessionId, error)
            } else {
              this.sender.sendCardMessage(chatId, buildErrorCard(`${errPrefix}${error}`)).catch(console.error)
            }
            this.sessionBuffers.delete(binding!.sessionId)
            this.cardStreamer.clearUsedSession(binding!.sessionId)
          },
          onComplete: () => {},
          onTitleUpdated: (_title) => {},
        })
      } catch (error) {
        console.error('[飞书 Bridge] Agent 运行异常:', error)
      }
    } else {
      await this.sender.sendMessage(chatId, 'Chat 模式暂未实现，请使用 /agent 切换到 Agent 模式。')
      this.sessionBuffers.delete(binding.sessionId)
    }
  }

  /** 创建新会话（从 CommandHandler 复用逻辑） */
  private async createNewSession(
    msgCtx: import('@proma/shared').FeishuMessageContext,
    mode: 'agent' | 'chat',
    title?: string,
    overrideWorkspaceId?: string,
  ): Promise<void> {
    await this.commandHandler.createNewSession(msgCtx, mode, title, overrideWorkspaceId)
  }

  // ===== 会话完成处理 =====

  private handleSessionComplete(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId)
    if (!buffer) return

    const usedStreamingCard = this.cardStreamer.hasUsedCard(sessionId)
    this.cardStreamer.clearUsedSession(sessionId)

    const duration = (Date.now() - buffer.startedAt) / 1000
    const toolSummaries = Array.from(buffer.toolSummaries.values())
    const result: FormattedAgentResult = {
      text: buffer.text,
      toolSummaries,
      duration,
    }

    const chatId = this.bindings.getChatIdBySessionId(sessionId)
    if (chatId && !usedStreamingCard) {
      this.sendAgentReply(chatId, result).catch(console.error)
    }
    this.sessionBuffers.delete(sessionId)
  }

  private async sendAgentReply(chatId: string, result: FormattedAgentResult): Promise<void> {
    const subtitle = resolveContextSubtitle(chatId, (cid) => this.bindings.get(cid))

    if (!result.text.trim()) {
      await this.sender.sendMessage(chatId, `${subtitle ? `${subtitle} | ` : ''}Agent 已完成（无文本输出）`)
      return
    }

    const binding = this.bindings.get(chatId)
    const processedResult: FormattedAgentResult = {
      ...result,
      text: binding?.chatType === 'group'
        ? this.convertMentionsToAtTags(result.text, chatId)
        : result.text,
    }

    const chunks = splitLongContent(processedResult.text)
    if (chunks.length === 1) {
      await this.sender.sendCardMessage(chatId, buildAgentReplyCard(processedResult, subtitle))
    } else {
      for (let i = 0; i < chunks.length; i++) {
        const chunkResult: FormattedAgentResult = {
          text: chunks[i]!,
          toolSummaries: i === chunks.length - 1 ? processedResult.toolSummaries : [],
          duration: i === chunks.length - 1 ? processedResult.duration : 0,
        }
        await this.sender.sendCardMessage(chatId, buildAgentReplyCard(chunkResult, subtitle))
      }
    }
  }

  // ===== @Name → <at> 转换 =====

  private convertMentionsToAtTags(text: string, chatId: string): string {
    const groupInfo = this.groupService.getCachedGroupInfo(chatId)
    if (!groupInfo?.members || groupInfo.members.length === 0) return text

    const nameToId = new Map<string, string>()
    for (const m of groupInfo.members) {
      if (m.openId !== this.connection.botOpenId) {
        nameToId.set(m.name, m.openId)
      }
    }
    if (nameToId.size === 0) return text

    const names = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length)
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`@(${escaped.join('|')})(?![\\w])`, 'g')

    return text.replace(pattern, (_, name: string) => {
      const openId = nameToId.get(name)
      return openId ? `<at id=${openId}>${name}</at>` : `@${name}`
    })
  }

  // ===== Agent 运行 =====

  private async runAgent(input: AgentSendInput): Promise<void> {
    // 委托给 agent-service 和 orchestrator
    try {
      await runAgentHeadless(input, {
        source: 'feishu',
        onError: (_error) => {},
        onComplete: () => {},
        onTitleUpdated: (_title) => {},
      })
    } catch (error) {
      console.error('[飞书 Bridge] Agent 运行异常:', error)
    }
  }

  // ===== 状态更新 =====

  private updateStatus(partial: { status?: string; activeBindings?: number; connectedAt?: number; errorMessage?: string }): void {
    const current = this.connection.status
    const next = { ...current, ...partial } as FeishuBridgeState

    // 广播到渲染进程
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(FEISHU_IPC_CHANNELS.STATUS_CHANGED, {
        ...next,
        botId: this.botConfig.id,
        botName: this.botConfig.name,
      })
    }
  }
}

// ===== 导出 =====

export { FeishuBridge }
