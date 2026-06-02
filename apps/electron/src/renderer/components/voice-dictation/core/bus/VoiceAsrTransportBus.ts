/**
 * 【第 6 层 - 基础设施层】ASR 对外交互总线
 *
 * 负责把 Provider 侧的传输请求事件，转交给统一的外部交互层处理，
 * 并把主进程回传的转写/状态事件再广播回 Provider。
 */

import type {
  MicPermissionResult,
  VoiceDictationAudioChunkInput,
  VoiceDictationStartInput,
  VoiceDictationStateEvent,
  VoiceDictationStopInput,
  VoiceDictationTranscriptEvent,
} from '@/types/settings'

export interface VoiceAsrTransportRequestMap {
  checkMicrophonePermission: undefined
  requestMicrophonePermission: undefined
  startVoiceDictation: VoiceDictationStartInput
  sendVoiceDictationAudio: VoiceDictationAudioChunkInput
  stopVoiceDictation: VoiceDictationStopInput
  cancelVoiceDictation: VoiceDictationStopInput
  getHandsfreeBuffer: undefined
}

export interface VoiceAsrTransportResponseMap {
  checkMicrophonePermission: MicPermissionResult
  requestMicrophonePermission: MicPermissionResult
  startVoiceDictation: void
  sendVoiceDictationAudio: void
  stopVoiceDictation: void
  cancelVoiceDictation: void
  getHandsfreeBuffer: ArrayBuffer | null
}

export interface VoiceAsrTransportEventMap {
  transcript: VoiceDictationTranscriptEvent
  state: VoiceDictationStateEvent
}

export interface VoiceAsrTransportRequest<K extends keyof VoiceAsrTransportRequestMap = keyof VoiceAsrTransportRequestMap> {
  id: string
  type: K
  payload: VoiceAsrTransportRequestMap[K]
}

export interface VoiceAsrTransportEvent<K extends keyof VoiceAsrTransportEventMap = keyof VoiceAsrTransportEventMap> {
  type: K
  payload: VoiceAsrTransportEventMap[K]
}

export type VoiceAsrTransportRequestListener = (
  request: VoiceAsrTransportRequest,
) => void

export type VoiceAsrTransportEventListener = (
  event: VoiceAsrTransportEvent,
) => void

export class VoiceAsrTransportBus {
  private readonly requestListeners = new Set<VoiceAsrTransportRequestListener>()
  private readonly eventListeners = new Set<VoiceAsrTransportEventListener>()
  private readonly pending = new Map<string, {
    resolve: (value: VoiceAsrTransportResponseMap[keyof VoiceAsrTransportResponseMap]) => void
    reject: (error: unknown) => void
  }>()

  onRequest(listener: VoiceAsrTransportRequestListener): () => void {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  onEvent(listener: VoiceAsrTransportEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  emitEvent<K extends keyof VoiceAsrTransportEventMap>(type: K, payload: VoiceAsrTransportEventMap[K]): void {
    for (const listener of this.eventListeners) {
      listener({ type, payload })
    }
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
    if (this.requestListeners.size === 0) {
      return Promise.reject(new Error('ASR 对外交互层未初始化'))
    }
    const id = crypto.randomUUID()
    return new Promise<VoiceAsrTransportResponseMap[K]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const request: VoiceAsrTransportRequest<K> = { id, type, payload }
      try {
        for (const listener of this.requestListeners) {
          listener(request)
        }
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  clear(): void {
    this.requestListeners.clear()
    this.eventListeners.clear()
    for (const pending of this.pending.values()) {
      pending.reject(new Error('ASR 对外交互层已关闭'))
    }
    this.pending.clear()
  }
}
