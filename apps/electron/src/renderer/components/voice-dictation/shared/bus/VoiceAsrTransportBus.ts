/**
 * 【第 6 层 - 基础设施层】ASR 对外交互总线
 *
 * 负责把 Provider 侧的传输请求事件，转交给统一的外部交互层处理，
 * 并把主进程回传的转写/状态事件再广播回 Provider。
 *
 * 这里没有强行继承纯事件总线，因为它同时包含两类不同语义：
 * - request/response：有唯一 id 的异步请求通道，需要 pending 表跟踪结果
 * - event broadcast：transcript / state 的广播通道，只负责向所有订阅者分发
 *
 * 所以这里保留独立实现，只复用订阅容器，避免把“请求-响应”语义压扁成普通事件。
 */

import type {
  MicPermissionResult,
  VoiceDictationAudioChunkInput,
  VoiceDictationStartInput,
  VoiceDictationStateEvent,
  VoiceDictationStopInput,
  VoiceDictationTranscriptEvent,
} from '@/types/settings'
import { SubscriptionSet } from './SubscriptionSet'

export interface VoiceAsrTransportRequestMap {
  /** 检查麦克风权限 */
  checkMicrophonePermission: undefined
  /** 主动申请麦克风权限 */
  requestMicrophonePermission: undefined
  /** 开始语音转写会话 */
  startVoiceDictation: VoiceDictationStartInput
  /** 发送音频分片 */
  sendVoiceDictationAudio: VoiceDictationAudioChunkInput
  /** 停止语音转写会话并保留结果 */
  stopVoiceDictation: VoiceDictationStopInput
  /** 取消语音转写会话并丢弃结果 */
  cancelVoiceDictation: VoiceDictationStopInput
  /** 获取免提缓冲区 */
  getHandsfreeBuffer: undefined
}

export interface VoiceAsrTransportResponseMap {
  /** 麦克风权限检查结果 */
  checkMicrophonePermission: MicPermissionResult
  /** 麦克风权限申请结果 */
  requestMicrophonePermission: MicPermissionResult
  /** 开始会话的确认结果 */
  startVoiceDictation: void
  /** 发送音频的确认结果 */
  sendVoiceDictationAudio: void
  /** 停止会话的确认结果 */
  stopVoiceDictation: void
  /** 取消会话的确认结果 */
  cancelVoiceDictation: void
  /** 免提缓冲区内容 */
  getHandsfreeBuffer: ArrayBuffer | null
}

export interface VoiceAsrTransportEventMap {
  /** 主进程回传的转写事件 */
  transcript: VoiceDictationTranscriptEvent
  /** 主进程回传的状态事件 */
  state: VoiceDictationStateEvent
}

export interface VoiceAsrTransportRequest<K extends keyof VoiceAsrTransportRequestMap = keyof VoiceAsrTransportRequestMap> {
  /** 请求唯一标识，用于 request / response 配对 */
  id: string
  /** 请求类型 */
  type: K
  /** 请求载荷 */
  payload: VoiceAsrTransportRequestMap[K]
}

/**
 * 广播事件联合类型
 *
 * 这里使用判别联合，确保消费方可以基于 type 做精确收窄。
 */
export type VoiceAsrTransportEvent =
  | { type: 'transcript'; payload: VoiceAsrTransportEventMap['transcript'] }
  | { type: 'state'; payload: VoiceAsrTransportEventMap['state'] }

export type VoiceAsrTransportRequestListener = (
  /** 完整请求对象 */
  request: VoiceAsrTransportRequest,
) => void

export type VoiceAsrTransportEventListener = (
  /** 广播事件对象 */
  event: VoiceAsrTransportEvent,
) => void

/**
 * ASR 对外交互总线
 *
 * 这个总线的职责很明确：把 Provider 与主进程之间的交互封装成
 * 一个“可订阅、可请求、可响应、可清理”的单点入口。
 */
export class VoiceAsrTransportBus {
  private readonly requestListeners = new SubscriptionSet<VoiceAsrTransportRequestListener>()
  private readonly eventListeners = new SubscriptionSet<VoiceAsrTransportEventListener>()
  private readonly pending = new Map<string, {
    /** 请求完成时的 resolve */
    resolve: (value: unknown) => void
    /** 请求失败时的 reject */
    reject: (error: unknown) => void
  }>()

  /**
   * 订阅请求通道
   *
   * Provider 发起 ASR 相关请求时，外部交互层通过这里接收完整请求对象。
   * 典型使用方是 useVoiceOrchestrator 里负责桥接 IPC 的那层代码。
   */
  onRequest(listener: VoiceAsrTransportRequestListener): () => void {
    return this.requestListeners.add(listener)
  }

  /**
   * 订阅广播通道
   *
   * 主进程回传的 transcript/state 会通过这里重新分发给 Provider。
   * 这一层不做业务判断，只负责把事件送到所有监听者。
   */
  onEvent(listener: VoiceAsrTransportEventListener): () => void {
    return this.eventListeners.add(listener)
  }

  /**
   * 广播状态事件
   *
   * 两种事件的 payload 结构不同，所以这里显式分支构造判别联合。
   * 这样外部订阅方拿到的事件永远是完整的 { type, payload } 结构，
   * 不需要自己再根据额外字段做二次拼装。
   */
  emitEvent<K extends keyof VoiceAsrTransportEventMap>(type: K, payload: VoiceAsrTransportEventMap[K]): void {
    this.eventListeners.forEach((listener) => {
      if (type === 'transcript') {
        listener({
          type,
          payload: payload as VoiceAsrTransportEventMap['transcript'],
        })
        return
      }
      listener({
        type,
        payload: payload as VoiceAsrTransportEventMap['state'],
      })
    })
  }

  respond<K extends keyof VoiceAsrTransportResponseMap>(
    id: string,
    value: VoiceAsrTransportResponseMap[K],
  ): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.resolve(value)
  }

  reject(id: string, error: unknown): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.reject(error)
  }

  request<K extends keyof VoiceAsrTransportRequestMap>(
    type: K,
    payload: VoiceAsrTransportRequestMap[K],
  ): Promise<VoiceAsrTransportResponseMap[K]> {
    // 没有请求处理方时，直接失败，避免挂起一个永远不会被响应的 Promise。
    if (this.requestListeners.size() === 0) {
      return Promise.reject(new Error('ASR 对外交互层未初始化'))
    }
    const id = crypto.randomUUID()
    return new Promise<VoiceAsrTransportResponseMap[K]>((resolve, reject) => {
      // 先登记 pending，再向外分发请求，确保同步响应也能命中。
      this.pending.set(id, {
        resolve: (value) => resolve(value as VoiceAsrTransportResponseMap[K]),
        reject,
      })
      const request: VoiceAsrTransportRequest<K> = { id, type, payload }
      try {
        this.requestListeners.forEach((listener) => {
          listener(request)
        })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  clear(): void {
    // 先清订阅，再拒绝未完成请求，避免遗留挂起 Promise。
    // 这样关闭总线后，所有监听方和未完成请求都会进入明确的结束态。
    this.requestListeners.clear()
    this.eventListeners.clear()
    for (const pending of this.pending.values()) {
      pending.reject(new Error('ASR 对外交互层已关闭'))
    }
    this.pending.clear()
  }
}
