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
          const result = await window.electronAPI.checkMicrophonePermission()
          this.bus.respond(request.id, result)
          return
        }
        case 'requestMicrophonePermission': {
          const result = await window.electronAPI.requestMicrophonePermission()
          this.bus.respond(request.id, result)
          return
        }
        case 'startVoiceDictation': {
          await window.electronAPI.startVoiceDictation(request.payload as VoiceDictationStartInput)
          this.bus.respond(request.id, undefined)
          return
        }
        case 'sendVoiceDictationAudio': {
          await window.electronAPI.sendVoiceDictationAudio(request.payload as VoiceDictationAudioChunkInput)
          this.bus.respond(request.id, undefined)
          return
        }
        case 'stopVoiceDictation': {
          await window.electronAPI.stopVoiceDictation(request.payload as VoiceDictationStopInput)
          this.bus.respond(request.id, undefined)
          return
        }
        case 'cancelVoiceDictation': {
          await window.electronAPI.cancelVoiceDictation(request.payload as VoiceDictationStopInput)
          this.bus.respond(request.id, undefined)
          return
        }
        case 'getHandsfreeBuffer': {
          const buffer = await window.electronAPI.getHandsfreeBuffer()
          this.bus.respond(request.id, buffer)
          return
        }
      }
    } catch (error) {
      this.bus.reject(request.id, error)
    }
  }
}
