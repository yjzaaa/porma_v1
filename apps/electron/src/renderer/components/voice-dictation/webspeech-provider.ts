/**
 * Web Speech API ASR Provider
 *
 * 浏览器内置 SpeechRecognition，零 IPC、零 API Key。
 * Electron 中依赖 Chrome 的 webkitSpeechRecognition。
 */

import type { ASRProvider, ASRCallbacks } from './asr-types'

// Web Speech API type shim
interface SpeechRecognition_ {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((ev: any) => void) | null
  onerror: ((ev: any) => void) | null
  onend: (() => void) | null
}

const SpeechCtor = ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) as
  (new () => SpeechRecognition_) | undefined

export class WebSpeechProvider implements ASRProvider {
  private recognition: SpeechRecognition_ | null = null
  private callbacks: ASRCallbacks | null = null
  private finalText = ''
  private disposed = false
  private userStopped = false

  async start(callbacks: ASRCallbacks): Promise<void> {
    if (!SpeechCtor) { callbacks.onError?.('浏览器不支持 SpeechRecognition'); return }
    this.callbacks = callbacks; this.finalText = ''; this.disposed = false
    this.startSession()
  }

  private startSession(): void {
    if (this.disposed || !this.callbacks || !SpeechCtor) return
    const r = new SpeechCtor()
    this.recognition = r
    r.continuous = true; r.interimResults = true; r.lang = 'zh-CN'; r.maxAlternatives = 1

    r.onresult = (ev: any) => {
      if (this.disposed) return
      let final = '', interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]; if (!res) continue
        const t = res[0]?.transcript ?? ''
        if (res.isFinal) { final += t; this.finalText += t } else { interim += t }
      }
      if (final || interim) this.callbacks?.onTranscript(this.finalText + interim, !interim)
    }

    r.onerror = (ev: any) => {
      if (this.disposed) return
      if (ev.error === 'no-speech' || ev.error === 'aborted') return
      this.callbacks?.onError?.(`识别错误: ${ev.error}`)
    }

    r.onend = () => {
      if (this.disposed) return
      if (!this.userStopped) this.callbacks?.onEnd?.(this.finalText.trim())
    }

    try { r.start() } catch { this.callbacks?.onError?.('启动失败') }
  }

  async stop(): Promise<string> {
    this.userStopped = true
    try { this.recognition?.stop() } catch {}
    await new Promise(r => setTimeout(r, 150))
    return this.finalText.trim()
  }

  async cancel(): Promise<void> {
    this.userStopped = true
    try { this.recognition?.abort() } catch {}
    this.finalText = ''
  }

  dispose(): void {
    this.disposed = true
    try { this.recognition?.abort() } catch {}
    this.recognition = null; this.callbacks = null
  }
}

export function isWebSpeechSupported(): boolean {
  return !!SpeechCtor
}
