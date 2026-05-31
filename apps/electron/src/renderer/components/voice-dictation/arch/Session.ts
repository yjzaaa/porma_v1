/**
 * Session — 封装一次完整的语音录制会话
 *
 * 生命周期：创建 → start() → 转写中 → stop() → complete → dispose
 * 每轮录音都是一个独立的 Session 实例，不跨轮泄漏状态。
 */

import type { PcmFrame } from './types'
import type { SessionCallbacks, SessionResult } from './types'
import type { AudioHub } from './AudioHub'
import { createASRProvider } from '../asr-factory'
import type { ASRProvider } from '../asr-types'
import type { VoiceDictationSettings } from '../../../../types'
import { CHUNK_BYTES, concatAudioBuffers, splitChunk } from '../voice-audio-utils'
import { shouldAutoSend } from '../voice-auto-send'

export class Session {
  private provider: ASRProvider | null = null
  private transcript = ''
  private commitMessage = ''
  private subs: Array<() => void> = []
  private silenceSince = 0
  private recordingStartedAt = 0
  private _disposed = false
  private _completed = false

  constructor(
    private hub: AudioHub,
    private settings: VoiceDictationSettings,
    private callbacks: SessionCallbacks,
  ) {}

  get disposed() { return this._disposed }

  /** 启动录制：订阅 PCM、启动 ASR */
  async start(): Promise<void> {
    if (this._disposed) return

    // 订阅 PCM 帧 → 实时音量 + 静音检测
    this.subs.push(this.hub.subscribe((frame: PcmFrame) => {
      if (this._disposed) return
      this.callbacks.onVolume(frame.peak)

      // 静音检测
      const now = performance.now()
      if (frame.peak >= 0.01) {
        this.silenceSince = now
      } else if (this.silenceSince > 0) {
        const t = this.settings.vadStopTimeoutMs || 1800
        const min = this.settings.vadMinRecordMs || 500
        if (t > 0 && (now - this.silenceSince) >= t && (now - this.recordingStartedAt) >= min) {
          this.stop().catch(() => {})
        }
      }
    }))

    this.recordingStartedAt = performance.now()
    this.silenceSince = this.recordingStartedAt

    // 创建 ASR engine
    const engine = this.settings.engine || 'doubao'
    this.provider = createASRProvider(engine)

    try {
      await this.provider.start({
        onTranscript: (text: string) => {
          if (this._disposed) return
          this.transcript = text
          this.callbacks.onTranscript(text)
        },
        onState: (_s: string, msg?: string) => {
          if (msg) this.callbacks.onMetadata(msg)
        },
        onVolume: (p: number) => this.callbacks.onVolume(p),
        onEnd: (text: string) => {
          if (text && !this._disposed) this.completeRecording()
        },
        onError: (msg: string) => {
          if (!this._disposed) this.callbacks.onError(msg)
        },
      })
    } catch {
      if (!this._disposed) this.callbacks.onError('ASR 引擎启动失败')
    }
  }

  /** 主动停止录音，返回最终文本 */
  async stop(): Promise<string> {
    if (this._disposed) return this.transcript
    if (!this.provider) return this.transcript

    const text = await this.provider.stop().catch(() => this.transcript)
    this.transcript = text || this.transcript
    this.completeRecording()
    return this.transcript
  }

  private completeRecording(): void {
    if (this._disposed || this._completed) return
    this._completed = true
    const text = this.transcript.trim()
    if (!text) {
      this.callbacks.onComplete({ text: '', commitMessage: '' })
      return
    }

    // commit + auto-send
    window.electronAPI.commitVoiceDictation({ text }).then(r => {
      this.commitMessage = r.message
      this.callbacks.onComplete({ text, commitMessage: r.message })

      // auto-send
      if (shouldAutoSend(text, this.settings.autoSendEnabled ?? true, 'always')) {
        this.tryAutoSend(text)
      }
    }).catch(err => {
      console.error('[Session] commit 失败:', err)
      this.callbacks.onError('输出失败')
    })
  }

  private tryAutoSend(text: string): void {
    // 通过 CustomEvent 委托给 GlobalShortcuts 的发送逻辑
    window.dispatchEvent(new CustomEvent('proma:insert-voice-dictation-text', {
      cancelable: true,
      detail: { text },
    }))
  }

  /** 取消录音 */
  cancel(): void {
    this.provider?.cancel().catch(() => {})
    this.dispose()
  }

  /** 释放资源 */
  dispose(): void {
    this._disposed = true
    this.provider?.dispose(); this.provider = null
    for (const unsub of this.subs) unsub()
    this.subs = []
  }
}
