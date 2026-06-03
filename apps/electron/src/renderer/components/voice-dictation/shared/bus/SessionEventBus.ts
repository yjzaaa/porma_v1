/**
 * Session 事件总线（事件驱动）
 *
 * 提供单次录音会话的类型安全事件发布/订阅能力，替代回调对象注入。
 */

import {
  SESSION_EVENT_COMPLETE,
  SESSION_EVENT_ERROR,
  SESSION_EVENT_KEYS,
  SESSION_EVENT_METADATA,
  SESSION_EVENT_TRANSCRIPT,
  SESSION_EVENT_VOLUME,
} from './SessionEventKeys'
import { AbstractTypedEventBus, type TypedListenerMap } from './AbstractTypedEventBus'

/** Session 事件载荷映射 */
export interface SessionEventMap {
  /** 实时音量（0-1） */
  [SESSION_EVENT_VOLUME]: number
  /** 实时转写文本 */
  [SESSION_EVENT_TRANSCRIPT]: { text: string; isFinal?: boolean }
  /** 元数据消息（如连接状态） */
  [SESSION_EVENT_METADATA]: string
  /** 会话完成结果 */
  [SESSION_EVENT_COMPLETE]: { text: string }
  /** 会话错误信息 */
  [SESSION_EVENT_ERROR]: string
}

/** Session 事件名 */
export type SessionEventType = keyof SessionEventMap

/** Session 事件监听器 */
export type SessionEventListener<K extends SessionEventType> = (payload: SessionEventMap[K]) => void

/**
 * Session 事件总线
 *
 * 只承载单次录音会话内部的事件，生命周期跟 Session 一一对应，
 * 因此保留独立总线而不并入更大的领域总线。
 */
export class SessionEventBus extends AbstractTypedEventBus<SessionEventMap> {
  constructor() {
    super({
      // 事件键固定，初始化时一次性建好对应监听器集合。
      [SESSION_EVENT_KEYS.volume]: new Set(),
      [SESSION_EVENT_KEYS.transcript]: new Set(),
      [SESSION_EVENT_KEYS.metadata]: new Set(),
      [SESSION_EVENT_KEYS.complete]: new Set(),
      [SESSION_EVENT_KEYS.error]: new Set(),
    } satisfies TypedListenerMap<SessionEventMap>)
  }
}
