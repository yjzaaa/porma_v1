/**
 * 【第 2 层 - 运行时层】AudioHub 麦克风 PCM 采集单例管理器
 *
 * 核心职责：
 *   1. 通过 getUserMedia 获取麦克风音频流（整个应用仅此一处调用）
 *   2. 使用 ScriptProcessorNode 将音频转换为 16-bit PCM 帧
 *   3. 通过发布-订阅模式广播 PCM 帧给 VAD 检测和 Session
 *   4. 维护更长的环形缓冲供免提模式下回取预录音频
 *
 * 设计要点：
 *   - 单例模式：由 Orchestrator 持有，VAD 和 Session 共享同一音频源
 *   - 幂等启停：多次调用 start()/stop() 安全，防止竞态
 *   - 异常隔离：单个订阅者异常不影响其他订阅者
 */

import type { PcmFrame, PcmSubscriber } from '../../types/panel'

/** AudioContext 引用（兼容 WebKit 前缀） */
const ACTX = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined

export class AudioHub {
  /** 底层 MediaStream 引用 */
  private stream: MediaStream | null = null
  /** AudioContext 实例 */
  private ctx: AudioContext | null = null
  /** ScriptProcessorNode 音频处理节点 */
  private proc: ScriptProcessorNode | null = null
  /** PCM 帧订阅者集合 */
  private subscribers = new Set<PcmSubscriber>()
  /** 采集运行状态 */
  private _running = false

  /**
   *   5 秒环形缓冲（16-bit PCM @ 16000Hz）
   * 用于免提模式：VAD 检测到语音时，可回取更长的触发前音频作为 ASR 上下文
   */
    readonly ringBuffer = new Int16Array(16000 * 5)
  /** 环形缓冲当前写入位置 */
  ringIndex = 0

  /** 是否正在采集 */
  get running() { return this._running }

  /**
   * 启动麦克风音频采集
   *
   * @throws 浏览器不支持音频采集时抛出 Error
   *
   * 流程：
   *   1. 请求 getUserMedia 权限和音频流
   *   2. 创建 AudioContext + ScriptProcessorNode（2048 帧缓冲，单声道）
   *   3. 注册 audioprocess 回调：Float32 → Int16 PCM 转换 → 广播帧
   *   4. 维护环形缓冲（滚动写入最新 3 秒 PCM 数据）
   */
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

      // 计算帧峰值
      let peak = 0
      for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i] ?? 0))

      // Float32 → Int16 PCM 转换并写入环形缓冲
      const pcm = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i] ?? 0)) // 钳位
        const val = s < 0 ? s * 0x8000 : s * 0x7fff         // 有符号 16-bit
        pcm[i] = val
        self.ringBuffer[self.ringIndex] = val
        self.ringIndex = (self.ringIndex + 1) % self.ringBuffer.length
      }

      // 广播 PCM 帧给所有订阅者
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

  /**
   * 停止麦克风采集（幂等执行）
   *
   * 清理顺序：断开处理节点 → 关闭 AudioContext → 释放 MediaStream tracks
   */
  stop(): void {
    if (!this._running) return
    this._running = false
    this.proc?.disconnect(); this.proc = null
    this.ctx?.close().catch(() => {}); this.ctx = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null
  }

  /**
   * 订阅 PCM 音频帧
   *
   * @param sub - 帧回调函数，每次 audioprocess 触发时收到一帧
   * @returns 取消订阅函数
   */
  subscribe(sub: PcmSubscriber): () => void {
    this.subscribers.add(sub)
    return () => { this.subscribers.delete(sub) }
  }
}
