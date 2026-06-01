/**
 * 语音模块 — Session 单次录音会话
 *
 * 生命周期：
 *   创建 → start() → ASR 转写中 → stop() / 静音超时停止 → completeRecording → dispose
 *
 * 关键契约：
 *   - 每轮录音一个独立 Session 实例，不跨轮泄漏状态
 *   - VAD 静音检测通过订阅 PCM 帧函数实现（由 Orchestrator 注入 AudioHub.subscribe）
 *   - ASR Provider 由外部注入（依赖倒置），Session 不直接创建或引用 ASR 实现
 *   - 静音超过 vadStopTimeoutMs 自动触发 stop()
 *   - 转写输出通过 IPC commitVoiceDictation 提交到主进程
 *   - dispose() 必须是幂等的，可多次安全调用
 *
 * 依赖注入（所有依赖在构造函数中传入，不自行 import）：
 *   - subscribe: PCM 帧订阅函数 → 由 Orchestrator 绑定 AudioHub.subscribe
 *   - provider: ASRProvider 实例 → 由 Orchestrator 通过 createASRProvider 创建
 *   - settings: VoiceDictationSettings → 当前语音配置
 *   - callbacks: SessionCallbacks → Orchestrator 回调
 *
 * @see ../types/panel.ts - PcmSubscriber / SessionCallbacks / SessionResult 定义
 * @see ../types/asr.ts - ASRProvider 接口
 */

import type { PcmFrame, PcmSubscriber } from '../types/panel'
import type { SessionCallbacks, SessionResult } from '../types/panel'
import type { ASRProvider } from '../types/asr'
import type { VoiceDictationSettings } from '../../../../types'

export class Session {
  /** ASR Provider 引用 */
  private provider: ASRProvider | null = null
  /** 当前累积的转写文本 */
  private transcript = ''
  /** 提交后返回的消息 */
  private commitMessage = ''
  /** 取消订阅函数数组（PCM 帧订阅等） */
  private subs: Array<() => void> = []
  /** 最近一次感知到非静音的时间戳（performance.now） */
  private silenceSince = 0
  /** 本次录音开始时间戳 */
  private recordingStartedAt = 0
  /** 是否已释放 */
  private _disposed = false
  /** 是否已完成（防止 completeRecording 被多次调用） */
  private _completed = false

  constructor(
    private subscribe: (sub: PcmSubscriber) => () => void,
    provider: ASRProvider,
    private settings: VoiceDictationSettings,
    private callbacks: SessionCallbacks,
  ) {
    this.provider = provider
  }

  /** 是否已释放 */
  get disposed() { return this._disposed }

  /**
   * 启动录音会话
   *
   * 流程：
   *   1. 订阅 PCM 帧 → 实时音量回调 + VAD 静音检测
   *   2. 记录录音开始时间
   *   3. 启动已注入的 ASR Provider
   *
   * VAD 静音检测逻辑：
   *   - peak < 0.01 → 视为静音
   *   - 静音持续时间 >= vadStopTimeoutMs 且录音时长 >= vadMinRecordMs → 自动 stop()
   */
  async start(): Promise<void> {
    if (this._disposed) return

    // 订阅 PCM 帧 → 实时音量 + 静音检测
    this.subs.push(this.subscribe((frame: PcmFrame) => {
      if (this._disposed) return
      this.callbacks.onVolume(frame.peak)

      const now = performance.now()
      // peak >= 0.01 视为有声音，重置静音计时
      if (frame.peak >= 0.01) {
        this.silenceSince = now
      } else if (this.silenceSince > 0) {
        const t = this.settings.vadStopTimeoutMs || 1800
        const min = this.settings.vadMinRecordMs || 500
        // 静音超时且录音时间足够 → 自动停止
        if (t > 0 && (now - this.silenceSince) >= t && (now - this.recordingStartedAt) >= min) {
          this.stop().catch(() => {})
        }
      }
    }))

    this.recordingStartedAt = performance.now()
    this.silenceSince = this.recordingStartedAt

    const provider = this.provider
    if (!provider) return

    try {
      await provider.start({
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
          // Provider 端主动结束时（如 WebSpeech 自动断连）直接完成
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

  /**
   * 主动停止录音并返回最终文本
   *
   * @returns 最终累积的转写文本
   *
   * 调用 stop() 后 ASR Provider 返回最终结果，触发 completeRecording 完成流程。
   * dispose() 后调用返回已累积的文本但不触发 complete。
   */
  async stop(): Promise<string> {
    if (this._disposed) return this.transcript
    if (!this.provider) return this.transcript

    const text = await this.provider.stop().catch(() => this.transcript)
    this.transcript = text || this.transcript
    this.completeRecording()
    return this.transcript
  }

  /**
   * 完成录音：提交转写文本到主进程并通知回调
   *
   * 防护：_disposed 和 _completed 双重守卫，确保只执行一次。
   * 空文本时直接返回空结果，不触发 commit IPC。
   */
  private completeRecording(): void {
    if (this._disposed || this._completed) return
    this._completed = true
    const text = this.transcript.trim()
    if (!text) {
      this.callbacks.onComplete({ text: '', commitMessage: '' })
      return
    }

    // 通过 IPC 将转写文本输出到当前活跃的输入框
    window.electronAPI.commitVoiceDictation({ text }).then(r => {
      this.commitMessage = r.message
      this.callbacks.onComplete({ text, commitMessage: r.message })
    }).catch(err => {
      console.error('[Session] commit 失败:', err)
      this.callbacks.onError('输出失败')
    })
  }

  /**
   * 取消录音（丢弃结果）
   *
   * 直接取消 ASR 并释放，不触发 completeRecording。
   */
  cancel(): void {
    this.provider?.cancel().catch(() => {})
    this.dispose()
  }

  /**
   * 释放所有资源（幂等）
   *
   * 清理顺序：标记 disposed → 释放 ASR Provider → 取消所有订阅
   */
  dispose(): void {
    this._disposed = true
    this.provider?.dispose(); this.provider = null
    for (const unsub of this.subs) unsub()
    this.subs = []
  }
}
