/**
 * 语音模块 — ASR 对外交互模块
 *
 * 统一接管 provider 的外部 IPC 交互请求，避免 provider 直接依赖 window.electronAPI。
 */

import type {
  VoiceDictationAudioChunkInput,
  VoiceDictationStartInput,
  VoiceDictationStopInput,
} from '@/types/settings'
import type { VoiceAsrTransportBus, VoiceAsrTransportRequest } from '../bus/VoiceAsrTransportBus'

export class VoiceAsrTransportModule {
  private readonly unsubs: Array<() => void> = []
  private readonly transcriptUnsub: (() => void) | null
  private readonly stateUnsub: (() => void) | null
  private readonly requestTimeoutMs = {
    permission: 5000,
    start: 10000,
    audio: 8000,
    stop: 10000,
    buffer: 5000,
  } as const

  constructor(private readonly bus: VoiceAsrTransportBus) {
    this.unsubs.push(this.bus.onRequest((request) => this.handleRequest(request)))

    this.transcriptUnsub = window.electronAPI.onVoiceDictationTranscript((event) => {
      this.bus.emitEvent('transcript', event)
    })

    this.stateUnsub = window.electronAPI.onVoiceDictationState((event) => {
      this.bus.emitEvent('state', event)
    })
  }

  dispose(): void {
    this.unsubs.forEach((unsub) => unsub())
    this.transcriptUnsub?.()
    this.stateUnsub?.()
    this.bus.clear()
  }

  private async handleRequest(request: VoiceAsrTransportRequest): Promise<void> {
    try {
      switch (request.type) {
        case 'checkMicrophonePermission': {
          const result = await this.withTimeout(
            window.electronAPI.checkMicrophonePermission(),
            this.requestTimeoutMs.permission,
            '检查麦克风权限',
          )
          this.bus.respond(request.id, result)
          return
        }
        case 'requestMicrophonePermission': {
          const result = await this.withTimeout(
            window.electronAPI.requestMicrophonePermission(),
            this.requestTimeoutMs.permission,
            '请求麦克风权限',
          )
          this.bus.respond(request.id, result)
          return
        }
        case 'startVoiceDictation': {
          await this.withTimeout(
            window.electronAPI.startVoiceDictation(request.payload as VoiceDictationStartInput),
            this.requestTimeoutMs.start,
            '启动语音识别',
          )
          this.bus.respond(request.id, undefined)
          return
        }
        case 'sendVoiceDictationAudio': {
          await this.withTimeout(
            window.electronAPI.sendVoiceDictationAudio(request.payload as VoiceDictationAudioChunkInput),
            this.requestTimeoutMs.audio,
            '发送语音分片',
          )
          this.bus.respond(request.id, undefined)
          return
        }
        case 'stopVoiceDictation': {
          await this.withTimeout(
            window.electronAPI.stopVoiceDictation(request.payload as VoiceDictationStopInput),
            this.requestTimeoutMs.stop,
            '停止语音识别',
          )
          this.bus.respond(request.id, undefined)
          return
        }
        case 'cancelVoiceDictation': {
          await this.withTimeout(
            window.electronAPI.cancelVoiceDictation(request.payload as VoiceDictationStopInput),
            this.requestTimeoutMs.stop,
            '取消语音识别',
          )
          this.bus.respond(request.id, undefined)
          return
        }
        case 'getHandsfreeBuffer': {
          const buffer = await this.withTimeout(
            window.electronAPI.getHandsfreeBuffer(),
            this.requestTimeoutMs.buffer,
            '获取免提缓冲',
          )
          this.bus.respond(request.id, buffer)
          return
        }
      }
    } catch (error) {
      this.bus.reject(request.id, error)
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${label}超时`))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
