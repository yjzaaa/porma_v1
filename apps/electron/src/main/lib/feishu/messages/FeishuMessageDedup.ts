/**
 * 消息去重 + 处理锁
 *
 * 防止 WebSocket 重复投递和 Bot 消息回环。
 */
import { ScopedQueue } from '../scoped-queue'

export const MESSAGE_DEBOUNCE_MS = 600
const DEDUP_MAX = 200

export interface DedupSet {
  add(id: string): void
  has(id: string): boolean
  delete(id: string): boolean
}

export class FeishuMessageDedup {
  /** 消息去重（防止 SDK WebSocket 重复投递） */
  private recentMessageIds = new Set<string>()
  /** 事件去重（防止网关超时重投） */
  private recentEventIds = new Set<string>()
  /** chatId 级处理锁（防止 bot 回复触发的事件重入） */
  private processingChats = new Set<string>()

  /** 防抖队列：scope → 累积的待处理消息 */
  readonly messageQueue: ScopedQueue<any>

  constructor(
    debounceMs: number,
    onFlush: (scope: string, batch: any[]) => void,
  ) {
    this.messageQueue = new ScopedQueue<any>(debounceMs, onFlush)
  }

  isDuplicateEvent(eventId: string): boolean {
    if (this.recentEventIds.has(eventId)) return true
    this.addToDedup(this.recentEventIds, eventId)
    return false
  }

  isDuplicateMessage(messageId: string): boolean {
    if (this.recentMessageIds.has(messageId)) return true
    this.addToDedup(this.recentMessageIds, messageId)
    return false
  }

  trackSentMessage(messageId: string): void {
    this.addToDedup(this.recentMessageIds, messageId)
  }

  isChatLocked(chatId: string): boolean {
    return this.processingChats.has(chatId)
  }

  lockChat(chatId: string): void {
    this.processingChats.add(chatId)
  }

  unlockChat(chatId: string): void {
    this.processingChats.delete(chatId)
  }

  clear(): void {
    this.recentMessageIds.clear()
    this.recentEventIds.clear()
    this.processingChats.clear()
    this.messageQueue.cancelAll()
  }

  private addToDedup(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size > DEDUP_MAX) {
      const first = set.values().next().value as string
      set.delete(first)
    }
  }
}
