/**
 * 语音模块 — Session 单次录音会话
 *
 * 生命周期：
 *   创建 → start() → ASR 转写中 → stop() / 静音超时停止 → completeRecording → dispose
 *
 * 关键契约：
 *   - 每轮录音一个独立 Session 实例，不跨轮泄漏状态
 *   - VAD 静音检测通过 VADDetector.isSpeaking 判断（自适应阈值 + 挂尾保护）
 *   - ASR Provider 由外部注入（依赖倒置），Session 不直接创建或引用 ASR 实现
 *   - 静音超过 vadStopTimeoutMs 自动触发 stop()
 *   - 转写输出通过 IPC commitVoiceDictation 提交到主进程
 *   - dispose() 必须是幂等的，可多次安全调用
 *
 * 依赖注入（所有依赖在构造函数中传入，不自行 import）：
 *   - subscribe: PCM 帧订阅函数 → 由 Orchestrator 绑定 AudioHub.subscribe
 *   - vad: VADDetector 实例 → 由 Orchestrator 持有，Session 读取 isSpeaking
 *   - provider: ASRProvider 实例 → 由 Orchestrator 通过 createASRProvider 创建
 *   - settings: VoiceDictationSettings → 当前语音配置
 *   - events: SessionEventBus → Orchestrator 订阅 Session 事件
 *
 * @see ./VADDetector.ts - 自适应 VAD 算法
 * @see ../types/panel.ts - PcmSubscriber / SessionResult 定义
 * @see ../types/asr.ts - ASRProvider 接口
 */

import type { PcmFrame, PcmSubscriber } from '../../types/panel'
import type { ASRProvider } from '../../types/asr'
import type { VoiceDictationSettings } from '../../../../../types'
import type { VADDetector } from './VADDetector'
import { SessionEventBus } from '../bus/SessionEventBus'
import {
  SESSION_EVENT_COMPLETE,
  SESSION_EVENT_ERROR,
  SESSION_EVENT_METADATA,
  SESSION_EVENT_TRANSCRIPT,
  SESSION_EVENT_VOLUME,
} from '../bus/SessionEventKeys'

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
  /** 事件总线（事件驱动） */
  readonly events = new SessionEventBus()

  constructor(
    private subscribe: (sub: PcmSubscriber) => () => void,
    private vad: VADDetector,
    provider: ASRProvider,
    private settings: VoiceDictationSettings,
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
   *   - 使用 VADDetector.isSpeaking 判断（自适应阈值 + 挂尾保护）
   *   - 静音持续时间 >= vadStopTimeoutMs 且录音时长 >= vadMinRecordMs → 自动 stop()
   */
  async start(): Promise<void> {
    if (this._disposed) return

    // 订阅 PCM 帧 → 实时音量 + VAD 静音检测
    this.subs.push(this.subscribe((frame: PcmFrame) => {
      if (this._disposed) return
      this.events.emit(SESSION_EVENT_VOLUME, frame.peak)

      const now = performance.now()
      // isSpeaking 由 VADDetector 基于自适应阈值判断（含挂尾保护）
      if (this.vad.isSpeaking) {
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
        onTranscript: (text: string, isFinal: boolean) => {
          if (this._disposed) return
          this.transcript = text
          this.events.emit(SESSION_EVENT_TRANSCRIPT, { text, isFinal })
        },
        onState: (_s: string, msg?: string) => {
          if (msg) this.events.emit(SESSION_EVENT_METADATA, msg)
        },
        onVolume: (p: number) => this.events.emit(SESSION_EVENT_VOLUME, p),
        onEnd: (text: string) => {
          // Provider 端主动结束时（如 WebSpeech 自动断连）直接完成
          if (text && !this._disposed) this.completeRecording()
        },
        onError: (msg: string) => {
          if (!this._disposed)           this.events.emit(SESSION_EVENT_ERROR, msg)
        },
      })
    } catch {
      if (!this._disposed) this.events.emit(SESSION_EVENT_ERROR, 'ASR 引擎启动失败')
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
   * 完成录音：提交转写文本到主进程并发布完成事件
   *
   * 防护：_disposed 和 _completed 双重守卫，确保只执行一次。
   * 空文本时直接返回空结果，不触发 commit IPC。
   */
  private completeRecording(): void {
    if (this._disposed || this._completed) return
    this._completed = true
    const text = this.transcript.trim()
    if (!text) {
      this.events.emit(SESSION_EVENT_COMPLETE, { text: '', commitMessage: '' })
      return
    }

    // 通过 IPC 将转写文本输出到当前活跃的输入框
    window.electronAPI.commitVoiceDictation({ text }).then(r => {
      this.commitMessage = r.message
      this.events.emit(SESSION_EVENT_COMPLETE, { text, commitMessage: r.message })
    }).catch(err => {
      console.error('[Session] commit 失败:', err)
      this.events.emit(SESSION_EVENT_ERROR, '输出失败')
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
    this.events.clear()
  }
}
