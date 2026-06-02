/**
 * Session 事件总线（事件驱动）
 *
 * 提供单次录音会话的类型安全事件发布/订阅能力，替代回调对象注入。
 */

import type { SessionResult } from '../../types/panel'

/** Session 事件载荷映射 */
export interface SessionEventMap {
  /** 实时音量（0-1） */
  volume: number
  /** 实时转写文本 */
  transcript: { text: string; isFinal?: boolean }
  /** 元数据消息（如连接状态） */
  metadata: string
  /** 会话完成结果 */
  complete: SessionResult
  /** 会话错误信息 */
  error: string
}

/** Session 事件名 */
export type SessionEventType = keyof SessionEventMap

/** Session 事件监听器 */
export type SessionEventListener<K extends SessionEventType> = (payload: SessionEventMap[K]) => void

/** Session 事件总线 */
export class SessionEventBus {
  private readonly listeners: {
    [K in SessionEventType]: Set<SessionEventListener<K>>
  } = {
      volume: new Set(),
      transcript: new Set(),
      metadata: new Set(),
      complete: new Set(),
      error: new Set(),
    }

  /**
   * 订阅事件
   */
  on<K extends SessionEventType>(event: K, listener: SessionEventListener<K>): () => void {
    const set = this.listeners[event]
    set.add(listener)
    return () => set.delete(listener)
  }

  /**
   * 发布事件
   */
  emit<K extends SessionEventType>(event: K, payload: SessionEventMap[K]): void {
    const set = this.listeners[event]
    for (const listener of set) {
      listener(payload)
    }
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.volume.clear()
    this.listeners.transcript.clear()
    this.listeners.metadata.clear()
    this.listeners.complete.clear()
    this.listeners.error.clear()
  }
}

