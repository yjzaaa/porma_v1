/**
 * 语音模块 — Session 单次录音会话
 *
 * 生命周期：
 *   创建 → start() → ASR 转写中 → stop() / cancel() → dispose
 *
 * 关键契约：
 *   - 每轮录音一个独立 Session 实例，不跨轮泄漏状态
 *   - ASR Provider 由外部注入（依赖倒置），Session 只负责管理会话生命周期
 *   - dispose() 必须是幂等的，可多次安全调用
 *
 * 依赖注入（所有依赖在构造函数中传入，不自行 import）：
 *   - provider: ASRProvider 实例 → 由 Orchestrator 通过 createASRProvider 创建
 *   - events: SessionEventBus → Orchestrator 订阅 Session 事件
 *
 * @see ../types/panel.ts - PcmFrame / SessionResult 定义
 * @see ../types/asr.ts - ASRProvider 接口
 */

import type { PcmFrame } from '../../types/panel'
import type { ASRProvider } from '../../types/asr'
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
  /** Provider 事件退订函数 */
  private providerUnsubs: Array<() => void> = []
  /** 是否已释放 */
  private _disposed = false
  /** 事件总线（事件驱动） */
  readonly events = new SessionEventBus()

  constructor(provider: ASRProvider) {
    this.provider = provider
  }

  /** 是否已释放 */
  get disposed() { return this._disposed }

  /**
   * 启动录音会话
   *
   * 流程：
   *   1. 绑定 Provider 事件
   *   2. 启动已注入的 ASR Provider
   */
  async start(): Promise<void> {
    if (this._disposed) return
    const provider = this.provider
    if (!provider) return

    this.bindProviderEvents(provider)

    try {
      await provider.start()
    } catch {
      if (!this._disposed) this.events.emit(SESSION_EVENT_ERROR, 'ASR 引擎启动失败')
    }
  }

  /**
   * 主动停止录音并返回最终文本
   *
   * @returns 最终累积的转写文本
   *
   * 调用 stop() 后 ASR Provider 返回最终结果，并发布 complete 事件。
   * dispose() 后调用返回已累积的文本但不触发 complete。
   */
  async stop(): Promise<string> {
    if (this._disposed) return this.transcript
    if (!this.provider) return this.transcript

    const text = await this.provider.stop().catch(() => this.transcript)
    this.transcript = text || this.transcript
    this.events.emit(SESSION_EVENT_COMPLETE, { text: this.transcript })
    return this.transcript
  }

  /**
   * 取消录音（丢弃结果）
   *
   * 直接取消 ASR 并释放，不触发完成事件。
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
    for (const unsub of this.providerUnsubs) unsub()
    this.providerUnsubs = []
    this.provider?.dispose(); this.provider = null
    this.events.clear()
  }

  /**
   * 接收 PCM 帧并转发给 Provider。
   */
  pushAudio(frame: PcmFrame): void {
    if (this._disposed) return
    this.provider?.pushAudio(frame)
  }

  /**
   * 绑定 Provider 事件到 Session 事件
   */
  private bindProviderEvents(provider: ASRProvider): void {
    this.providerUnsubs.push(
      provider.onEvent((event) => {
        if (this._disposed) return

        switch (event.type) {
          case 'state':
            if (event.message) this.events.emit(SESSION_EVENT_METADATA, event.message)
            return
          case 'transcript':
            this.transcript = event.text
            this.events.emit(SESSION_EVENT_TRANSCRIPT, { text: event.text, isFinal: event.isFinal })
            return
          case 'volume':
            this.events.emit(SESSION_EVENT_VOLUME, event.peak)
            return
          case 'end':
            if (event.text) {
              this.transcript = event.text
              this.events.emit(SESSION_EVENT_COMPLETE, { text: this.transcript })
            }
            return
          case 'error':
            this.events.emit(SESSION_EVENT_ERROR, event.message)
        }
      }),
    )
  }
}
