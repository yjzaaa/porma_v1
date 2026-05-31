/**
 * Doubao ASR Provider
 *
 * 封装豆包 ASR 的 IPC 通信，复用已有的主进程链路。
 * 需要 getUserMedia 采集 PCM 通过 IPC 发送。
 */

import type { ASRProvider, ASRCallbacks } from './asr-types'
import type { VoiceDictationSettings, VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../types'
import { CHUNK_BYTES, concatAudioBuffers, floatTo16BitPcm, splitChunk } from './voice-audio-utils'

const ACTX = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined

export class DoubaoProvider implements ASRProvider {
  private sessionId: string | null = null
  private asrReady = false
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private pendingAudio: ArrayBuffer[] = []
  private queuedAudio: ArrayBuffer[] = []
  private stopping = false
  private callbacks: ASRCallbacks | null = null
  private resolveStop: ((text: string) => void) | null = null
  private transcriptText = ''
  private stopTimeout: ReturnType<typeof setTimeout> | null = null
  private cleanupListeners: (() => void) | null = null

  async start(callbacks: ASRCallbacks): Promise<void> {
    this.callbacks = callbacks
    this.stopping = false
    this.asrReady = false
    this.pendingAudio = []
    this.queuedAudio = []
    this.transcriptText = ''

    // 检查麦克风权限
    const perm = await window.electronAPI.checkMicrophonePermission()
    if (perm.status === 'denied') { callbacks.onError?.('麦克风权限被阻止'); return }
    if (perm.status === 'not-determined') {
      const req = await window.electronAPI.requestMicrophonePermission()
      if (req.status !== 'granted') { callbacks.onError?.('需要麦克风权限'); return }
    }

    const sid = crypto.randomUUID()
    this.sessionId = sid

    // 订阅 IPC 事件
    const unsubs: Array<() => void> = []

    const ct = window.electronAPI.onVoiceDictationTranscript((e: VoiceDictationTranscriptEvent) => {
      if (e.sessionId !== this.sessionId) return
      this.transcriptText = e.text
      callbacks.onTranscript(e.text, e.isFinal)
    })
    unsubs.push(ct)

    const cs = window.electronAPI.onVoiceDictationState((e: VoiceDictationStateEvent) => {
      if (e.sessionId && e.sessionId !== this.sessionId) return
      if (e.message) callbacks.onState(e.status, e.message)
    })
    unsubs.push(cs)

    this.cleanupListeners = () => unsubs.forEach(f => f())

    // 先发历史缓冲（from VAD ring buffer）
    try {
      const buf = await window.electronAPI.getHandsfreeBuffer()
      if (buf && buf.byteLength > 0 && this.sessionId === sid) {
        const CH = 6400; let off = 0
        while (off < buf.byteLength) {
          const end = Math.min(off + CH, buf.byteLength)
          window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: buf.slice(off, end) }).catch(() => {}); off = end
        }
      }
    } catch {}

    // 启动 ASR 会话
    callbacks.onState('connecting', '连接 ASR...')
    await window.electronAPI.startVoiceDictation({ sessionId: sid })
    if (this.sessionId !== sid) return
    this.asrReady = true

    // 开始音频捕获
    await this.startCapture()
  }

  private async startCapture(): Promise<void> {
    if (!ACTX || !navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } },
      })
      if (this.stopping || !this.sessionId) { stream.getTracks().forEach(t => t.stop()); return }
      this.stream = stream
      const ac = new ACTX()
      this.audioContext = ac
      const src = ac.createMediaStreamSource(stream)
      const proc = ac.createScriptProcessor(4096, 1, 1)
      this.processor = proc
      const sid = this.sessionId

      proc.onaudioprocess = (ev: any) => {
        if (this.stopping || !this.sessionId || sid !== this.sessionId) return
        if (!this.asrReady) return
        const inp = ev.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < inp.length; i++) peak = Math.max(peak, Math.abs(inp[i] ?? 0))
        this.callbacks?.onVolume?.(Math.min(1, peak * 4))

        const pcm = floatTo16BitPcm(inp, ac.sampleRate)
        this.pendingAudio.push(pcm)
        let merged = concatAudioBuffers(this.pendingAudio)
        const next: ArrayBuffer[] = []
        while (merged.byteLength >= CHUNK_BYTES) {
          const { chunk, rest } = splitChunk(merged, CHUNK_BYTES)
          if (!chunk) break
          window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: chunk }).catch(() => {}); merged = rest
        }
        if (merged.byteLength > 0) next.push(merged)
        this.pendingAudio = next
      }

      src.connect(proc); proc.connect(ac.destination)
      if (ac.state === 'suspended') await ac.resume()
    } catch (err) {
      this.callbacks?.onError?.('麦克风启动失败')
    }
  }

  async stop(): Promise<string> {
    this.stopping = true
    const sid = this.sessionId

    // 清空剩余音频
    const pending = this.pendingAudio; this.pendingAudio = []
    if (sid) {
      for (const c of pending) window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: c }).catch(() => {})
    }

    // 停止捕获
    this.processor?.disconnect(); this.processor = null
    this.audioContext?.close().catch(() => {}); this.audioContext = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null

    // 停止 ASR 会话
    if (sid && this.asrReady) {
      await window.electronAPI.stopVoiceDictation({ sessionId: sid }).catch(() => {})
    }

    // 等待最终文本（短暂延迟让 ASR 返回剩余结果）
    const text = await new Promise<string>((resolve) => {
      this.stopTimeout = setTimeout(() => {
        resolve(this.transcriptText)
      }, 500)
    })

    return text.trim()
  }

  async cancel(): Promise<void> {
    this.stopping = true
    const sid = this.sessionId
    if (sid) { window.electronAPI.cancelVoiceDictation({ sessionId: sid }).catch(() => {}) }
    this.processor?.disconnect(); this.processor = null
    this.audioContext?.close().catch(() => {}); this.audioContext = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null
    this.pendingAudio = []
  }

  dispose(): void {
    this.cleanupListeners?.()
    this.cleanupListeners = null
    if (this.stopTimeout) clearTimeout(this.stopTimeout)
    this.cancel().catch(() => {})
    this.sessionId = null
    this.asrReady = false
    this.callbacks = null
  }
}
