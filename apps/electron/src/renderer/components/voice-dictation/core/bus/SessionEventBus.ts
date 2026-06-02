/**
 * Session 事件总线（事件驱动）
 *
 * 提供单次录音会话的类型安全事件发布/订阅能力，替代回调对象注入。
 */

import type { SessionResult } from '../../types/panel'
import {
  SESSION_EVENT_COMPLETE,
  SESSION_EVENT_ERROR,
  SESSION_EVENT_KEYS,
  SESSION_EVENT_METADATA,
  SESSION_EVENT_TRANSCRIPT,
  SESSION_EVENT_VOLUME,
} from './SessionEventKeys'

/** Session 事件载荷映射 */
export interface SessionEventMap {
  /** 实时音量（0-1） */
  [SESSION_EVENT_VOLUME]: number
  /** 实时转写文本 */
  [SESSION_EVENT_TRANSCRIPT]: { text: string; isFinal?: boolean }
  /** 元数据消息（如连接状态） */
  [SESSION_EVENT_METADATA]: string
  /** 会话完成结果 */
  [SESSION_EVENT_COMPLETE]: SessionResult
  /** 会话错误信息 */
  [SESSION_EVENT_ERROR]: string
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
    [SESSION_EVENT_KEYS.volume]: new Set(),
    [SESSION_EVENT_KEYS.transcript]: new Set(),
    [SESSION_EVENT_KEYS.metadata]: new Set(),
    [SESSION_EVENT_KEYS.complete]: new Set(),
    [SESSION_EVENT_KEYS.error]: new Set(),
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
    this.listeners[SESSION_EVENT_KEYS.volume].clear()
    this.listeners[SESSION_EVENT_KEYS.transcript].clear()
    this.listeners[SESSION_EVENT_KEYS.metadata].clear()
    this.listeners[SESSION_EVENT_KEYS.complete].clear()
    this.listeners[SESSION_EVENT_KEYS.error].clear()
  }
}
