/**
 * 流式卡片管理
 *
 * 负责流式卡片的创建、更新、错误/中断终态处理。
 */
import { CardStream } from '../card-stream'
import {
  createInitialState,
  finalizeIfRunning,
  markError,
  markInterrupted,
  reduce as reduceRunState,
} from '../card-run-state'
import { renderCard as renderRunCard } from '../card-renderer-v2'
import type { AgentStreamPayload, SDKAssistantMessage, SDKUserMessage } from '@proma/shared'
import type { RunState } from '../card-run-state'

export interface CardStreamEntry {
  state: RunState
  stream: CardStream
}

export class FeishuCardStreamer {
  /** sessionId → 流式卡片状态 */
  private streamingRunStates = new Map<string, RunState>()
  /** sessionId → 流式卡片句柄 */
  private streamingCards = new Map<string, CardStream>()
  /** 用过流式卡的 sessionId 集合 */
  private streamingCardsUsedSessions = new Set<string>()
  /** 已经处理过终态的 session 标记 */
  private streamingTerminalHandledSessions = new Map<string, number>()

  private static readonly TERMINAL_HANDLED_TTL_MS = 5 * 60 * 1000

  constructor(
    private getClient: () => InstanceType<
      typeof import('@larksuiteoapi/node-sdk').Client
    > | null,
    private resolvePrefix: (chatId: string) => string,
    private getChatIdBySession: (sessionId: string) => string | undefined,
  ) {}

  hasCard(sessionId: string): boolean {
    return this.streamingCards.has(sessionId)
  }

  hasUsedCard(sessionId: string): boolean {
    return this.streamingCardsUsedSessions.has(sessionId)
  }

  isTerminalHandled(sessionId: string): boolean {
    return this.streamingTerminalHandledSessions.has(sessionId)
  }

  clear(): void {
    for (const stream of this.streamingCards.values()) {
      void stream.close().catch(() => {})
    }
    this.streamingCards.clear()
    this.streamingRunStates.clear()
    this.streamingCardsUsedSessions.clear()
    this.streamingTerminalHandledSessions.clear()
  }

  clearSession(sessionId: string): void {
    this.streamingRunStates.delete(sessionId)
    this.streamingCards.delete(sessionId)
    this.streamingCardsUsedSessions.delete(sessionId)
  }

  /**
   * 为飞书发起的会话创建初始流式卡片
   */
  async startStream(
    sessionId: string,
    chatId: string,
    headerTitle: string,
    stopHint?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const client = this.getClient()
    if (!client) return false

    const initialState = createInitialState()
    this.streamingRunStates.set(sessionId, initialState)

    try {
      const cardStream = await CardStream.open(
        client,
        chatId,
        renderRunCard(initialState, {
          header: headerTitle,
          stopHint: stopHint ?? '发送 `/stop` 可终止当前任务',
        }),
        { replyToMessageId },
      )
      this.streamingCards.set(sessionId, cardStream)
      this.streamingCardsUsedSessions.add(sessionId)
      return true
    } catch (error) {
      console.error('[飞书 CardStreamer] 流式卡片创建失败:', error)
      this.streamingRunStates.delete(sessionId)
      return false
    }
  }

  /**
   * 为桌面 Session 镜像打开流式卡片
   */
  async startMirrorStream(
    sessionId: string,
    chatId: string,
    headerTitle: string,
    groupName?: string,
  ): Promise<boolean> {
    return this.startStream(sessionId, chatId, headerTitle, '在群里发送 `/stop` 可终止当前任务')
  }

  /**
   * 处理 Agent 事件推送，更新流式卡片
   */
  handlePayload(sessionId: string, payload: AgentStreamPayload): void {
    const runState = this.streamingRunStates.get(sessionId)
    const cardStream = this.streamingCards.get(sessionId)
    if (!runState || !cardStream) return

    const nextState = reduceRunState(runState, payload)
    if (nextState === runState) return

    this.streamingRunStates.set(sessionId, nextState)
    const chatId = this.getChatIdBySession(sessionId) ?? ''
    const prefix = this.resolvePrefix(chatId)
    const headerTitle =
      (prefix ? `${prefix.trim()} · ` : '') +
      (nextState.terminal === 'running' ? 'Agent 处理中' : 'Agent 已完成')
    const card = renderRunCard(nextState, {
      header: headerTitle,
      stopHint: nextState.terminal === 'running' ? '发送 `/stop` 可终止当前任务' : undefined,
    })

    if (nextState.terminal === 'running') {
      cardStream.update(card)
    } else {
      void cardStream
        .flush(card)
        .then(() => cardStream.close())
        .catch((err) => console.error('[飞书 CardStreamer] 终态刷新失败:', err))
      this.streamingRunStates.delete(sessionId)
      this.streamingCards.delete(sessionId)
    }
  }

  /**
   * 标记流式卡片为 error 终态
   */
  markError(sessionId: string, message: string): void {
    const runState = this.streamingRunStates.get(sessionId)
    const cardStream = this.streamingCards.get(sessionId)
    if (!runState || !cardStream) return

    const nextState = markError(runState, message)
    const chatId = this.getChatIdBySession(sessionId) ?? ''
    const prefix = this.resolvePrefix(chatId)
    this.flushAndClose(
      sessionId,
      cardStream,
      renderRunCard(nextState, {
        header: (prefix ? `${prefix.trim()} · ` : '') + 'Agent 出错',
      }),
    )
  }

  /**
   * 标记流式卡片为 interrupted 终态
   */
  markInterrupted(sessionId: string): void {
    const runState = this.streamingRunStates.get(sessionId)
    const cardStream = this.streamingCards.get(sessionId)
    if (!runState || !cardStream) return

    const nextState = markInterrupted(runState)
    const chatId = this.getChatIdBySession(sessionId) ?? ''
    const prefix = this.resolvePrefix(chatId)
    this.flushAndClose(
      sessionId,
      cardStream,
      renderRunCard(nextState, {
        header: (prefix ? `${prefix.trim()} · ` : '') + 'Agent 已中断',
      }),
    )
  }

  markTerminalHandled(sessionId: string): void {
    const now = Date.now()
    for (const [sid, ts] of this.streamingTerminalHandledSessions) {
      if (now - ts > FeishuCardStreamer.TERMINAL_HANDLED_TTL_MS) {
        this.streamingTerminalHandledSessions.delete(sid)
      }
    }
    this.streamingTerminalHandledSessions.set(sessionId, now)
  }

  clearTerminalHandled(sessionId: string): void {
    this.streamingTerminalHandledSessions.delete(sessionId)
  }

  markUsedSession(sessionId: string): void {
    this.streamingCardsUsedSessions.add(sessionId)
  }

  clearUsedSession(sessionId: string): void {
    this.streamingCardsUsedSessions.delete(sessionId)
  }

  /** 解构完毕时关闭流式卡（不等待） */
  closeCard(sessionId: string): void {
    const cardStream = this.streamingCards.get(sessionId)
    if (!cardStream) return
    void cardStream.close().catch(() => {})
    this.streamingCards.delete(sessionId)
    this.streamingRunStates.delete(sessionId)
  }

  private flushAndClose(
    sessionId: string,
    cardStream: CardStream,
    card: Record<string, unknown>,
  ): void {
    void cardStream
      .flush(card)
      .then(() => cardStream.close())
      .catch((err) => console.error('[飞书 CardStreamer] 终态刷新失败:', err))
    this.streamingRunStates.delete(sessionId)
    this.streamingCards.delete(sessionId)
  }
}
