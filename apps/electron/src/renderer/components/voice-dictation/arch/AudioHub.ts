/**
 * AudioHub — 麦克风单例管理器
 *
 * 整个应用只有一个 getUserMedia 调用。
 * VAD 和 Session 通过 subscribe() 接收 PCM 帧。
 * 启停控制由 Orchestrator 管理。
 */

import type { PcmFrame, PcmSubscriber } from './types'

const ACTX = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined

export class AudioHub {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private proc: ScriptProcessorNode | null = null
  private subscribers = new Set<PcmSubscriber>()
  private _running = false

  /** 3 秒环形缓冲（16-bit PCM @ 16000Hz） */
  readonly ringBuffer = new Int16Array(16000 * 3)
  ringIndex = 0

  get running() { return this._running }

  /** 启动麦克风采集 */
  async start(): Promise<void> {
    if (this._running) return
    if (!ACTX || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('浏览器不支持音频采集')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } },
    })
    this.stream = stream

    const ctx = new ACTX()
    this.ctx = ctx
    const src = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(2048, 1, 1)
    this.proc = proc

    const self = this
    proc.onaudioprocess = (ev: any) => {
      if (!self._running) return
      const input: Float32Array = ev.inputBuffer.getChannelData(0)

      // 峰值
      let peak = 0
      for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i] ?? 0))

      // 写入环形缓冲
      const pcm = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i] ?? 0))
        const val = s < 0 ? s * 0x8000 : s * 0x7fff
        pcm[i] = val
        self.ringBuffer[self.ringIndex] = val
        self.ringIndex = (self.ringIndex + 1) % self.ringBuffer.length
      }

      const frame: PcmFrame = { data: pcm, peak, sampleRate: ctx.sampleRate }
      for (const sub of self.subscribers) {
        try { sub(frame) } catch { /* 不让一个订阅者拖垮全部 */ }
      }
    }

    src.connect(proc)
    proc.connect(ctx.destination)
    if (ctx.state === 'suspended') await ctx.resume()
    this._running = true
  }

  /** 停止麦克风采集（幂等） */
  stop(): void {
    if (!this._running) return
    this._running = false
    this.proc?.disconnect(); this.proc = null
    this.ctx?.close().catch(() => {}); this.ctx = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null
  }

  /** 订阅 PCM 帧，返回 unsubscribe */
  subscribe(sub: PcmSubscriber): () => void {
    this.subscribers.add(sub)
    return () => { this.subscribers.delete(sub) }
  }
}
