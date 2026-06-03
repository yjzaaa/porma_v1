/**
 * 【第 2 层 - 运行时层】VoiceRecordingSession 单次录音会话
 *
 * 负责把底层 ASR Session 包装成更明确的领域对象：
 *   创建 → start() → recording → stop()/cancel() → settled → dispose
 *
 * 说明：
 *   - 该对象不直接处理 UI，只负责会话生命周期
 *   - “settled” 表示会话的外部收尾已完成，供 Capture 模块等待
 */

import type { PcmFrame } from '../../shared/types/panel'
import type { ASRProvider } from '../../shared/types/asr'
import type { SessionEventBus } from '../../shared/bus/SessionEventBus'
import { Session } from './Session'

export type VoiceRecordingSessionState =
  | 'created'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'disposed'

/**
 * 单次录音会话的领域包装
 */
export class VoiceRecordingSession {
  private readonly session: Session
  private readonly settledPromise: Promise<void>
  private settledResolve: (() => void) | null = null
  private _state: VoiceRecordingSessionState = 'created'
  private _settled = false
  private lastFinalText = ''

  constructor(provider: ASRProvider) {
    this.session = new Session(provider)
    this.settledPromise = new Promise<void>((resolve) => {
      this.settledResolve = resolve
    })

    this.session.events.on('complete', ({ text }) => {
      this.lastFinalText = text
      if (this._state !== 'cancelled') {
        this._state = 'completed'
      }
    })

    this.session.events.on('error', () => {
      if (this._state !== 'cancelled') {
        this._state = 'failed'
      }
      this.settle()
    })
  }

  /** 会话事件总线 */
  get events(): SessionEventBus {
    return this.session.events
  }

  /** 当前会话状态 */
  get state(): VoiceRecordingSessionState {
    return this._state
  }

  /** 是否已释放 */
  get disposed(): boolean {
    return this._state === 'disposed'
  }

  /** 是否已进入收尾 */
  get settled(): boolean {
    return this._settled
  }

  /**
   * 启动录音会话
   */
  async start(): Promise<void> {
    if (this.disposed || this._settled) return
    if (this._state !== 'created') return
    this._state = 'starting'
    await this.session.start()
    if (!this._settled && !this.disposed) {
      this._state = 'recording'
    }
  }

  /**
   * 推送 PCM 音频
   */
  pushAudio(frame: PcmFrame): void {
    if (this.disposed || this._settled) return
    this.session.pushAudio(frame)
  }

  /**
   * 停止录音并返回最终文本
   */
  async stop(): Promise<string> {
    if (this.disposed) return ''
    if (this._settled) return this.lastFinalText

    if (this._state === 'created') return ''
    this._state = 'stopping'
    const text = await this.session.stop().catch(() => '')
    this.lastFinalText = text || this.lastFinalText
    this._state = 'completed'
    return this.lastFinalText
  }

  /**
   * 取消录音会话
   */
  cancel(): void {
    if (this.disposed || this._settled) return
    this._state = 'cancelled'
    this.session.cancel()
    this.settle()
  }

  /**
   * 标记会话已完成外部收尾
   */
  settle(): void {
    if (this._settled) return
    this._settled = true
    this.settledResolve?.()
    this.settledResolve = null
  }

  /**
   * 等待会话完全收尾
   */
  waitUntilSettled(): Promise<void> {
    return this.settledPromise
  }

  /**
   * 释放会话资源
   */
  dispose(): void {
    if (this.disposed) return
    this._state = 'disposed'
    this.session.dispose()
    this.settle()
  }
}
