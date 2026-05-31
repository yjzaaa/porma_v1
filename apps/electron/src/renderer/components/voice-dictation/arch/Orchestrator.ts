/**
 * Orchestrator — 语音模块总调度器
 *
 * 职责：
 *   1. 持有 AudioHub 单例
 *   2. 持有 StateMachine
 *   3. 订阅 VAD 检测（基于 AudioHub 的 PCM 帧）
 *   4. 创建/销毁 Session
 *   5. 管理免提开关
 *   6. 广播 UIState 给 React 层
 */

import { AudioHub } from './AudioHub'
import { StateMachine } from './StateMachine'
import { Session } from './Session'
import type { PcmFrame, PanelState, UIStateListener, VoiceUIState } from './types'
import type { VoiceDictationSettings } from '../../../../types'

export class Orchestrator {
  readonly hub = new AudioHub()
  readonly fsm = new StateMachine()
  private session: Session | null = null
  private settings: VoiceDictationSettings | null = null
  private uiListeners = new Set<UIStateListener>()
  private unsubVAD: (() => void) | null = null

  /** 由 React 层注入的自动发送回调 */
  onAutoSend: ((text: string) => void) | null = null

  // UI state
  private volume = 0
  private transcript = ''
  private message = ''

  // VAD
  private consecutiveFrames = 0
  private lastTrigger = 0

  /** 广播 UI 状态 */
  private emit(): void {
    const state: VoiceUIState = {
      state: this.fsm.state,
      volume: this.volume,
      transcript: this.transcript,
      message: this.message,
      settings: this.settings,
    }
    for (const l of this.uiListeners) {
      try { l(state) } catch {}
    }
  }

  /** 订阅 UI 状态 */
  onUIState(fn: UIStateListener): () => void {
    this.uiListeners.add(fn)
    return () => { this.uiListeners.delete(fn) }
  }

  // ===== 免提开关 =====

  /** 开启免提：启动 AudioHub + 挂载 VAD 检测 */
  async enableHandsfree(): Promise<void> {
    if (!this.fsm.transition('listening')) return
    try {
      await this.hub.start()
    } catch (err) {
      console.error('[Orchestrator] 麦克风启动失败:', err)
      this.fsm.transition('stopped')
      this.message = '麦克风不可用'
      this.emit()
      return
    }

    // 订阅 VAD 检测
    this.unsubVAD = this.hub.subscribe((frame: PcmFrame) => {
      this.volume = frame.peak
      this.emit()
      this.detectSpeech(frame)
    })

    this.message = ''
    this.emit()
  }

  /** 关闭免提：停止 AudioHub + 取消活跃 Session */
  disableHandsfree(): void {
    this.cancelSession()
    this.unsubVAD?.(); this.unsubVAD = null
    this.hub.stop()
    this.volume = 0; this.consecutiveFrames = 0
    this.fsm.transition('stopped')
    this.message = ''
    this.emit()
  }

  /** 切换免提 */
  async toggleHandsfree(settings: VoiceDictationSettings): Promise<void> {
    this.settings = settings
    if (settings.handsfreeEnabled && settings.enabled) {
      await this.enableHandsfree()
    } else {
      this.disableHandsfree()
    }
  }

  // ===== VAD =====

  private detectSpeech(frame: PcmFrame): void {
    if (this.fsm.state !== 'listening') return

    const now = performance.now()
    if (frame.peak >= 0.02 && (now - this.lastTrigger) > 2000) {
      this.consecutiveFrames++
      if (this.consecutiveFrames >= 1) {
        this.consecutiveFrames = 0
        this.lastTrigger = now
        this.startSession()
      }
    } else {
      this.consecutiveFrames = 0
    }
  }

  // ===== Session =====

  private startSession(): void {
    if (this.session) { this.session.cancel(); this.session = null }
    if (!this.fsm.transition('recording')) return
    if (!this.settings) return

    this.transcript = ''; this.message = '正在监听...'
    this.emit()

    const session = new Session(this.hub, this.settings, {
      onVolume: (p: number) => { this.volume = p; this.emit() },
      onTranscript: (t: string) => { this.transcript = t; this.emit() },
      onMetadata: (m: string) => { this.message = m; this.emit() },
      onComplete: (result) => {
        this.session = null
        this.message = result.commitMessage
        this.emit()

        // auto-send
        if (result.text) {
          this.onAutoSend?.(result.text)
        }

        // completed → stopped → listening
        this.fsm.transition('stopped')
        this.emit()
        setTimeout(() => {
          if (this.settings?.handsfreeEnabled) {
            this.volume = 0; this.transcript = ''; this.message = ''
            this.fsm.transition('listening')
            this.emit()
          }
        }, 2000)
      },
      onError: (m: string) => {
        this.session = null
        this.fsm.transition('error')
        this.message = m
        this.emit()
        setTimeout(() => {
          this.fsm.transition('stopped')
          if (this.settings?.handsfreeEnabled) this.fsm.transition('listening')
          this.emit()
        }, 2000)
      },
    })

    this.session = session
    session.start().catch(() => {})
  }

  private cancelSession(): void {
    if (this.session) {
      this.session.cancel()
      this.session = null
    }
  }

  /** 手动停止录音（快捷键） */
  async stopRecording(): Promise<void> {
    if (this.fsm.state !== 'recording') return
    if (!this.session) return
    const text = await this.session.stop().catch(() => '')
    this.transcript = text
  }

  /** 销毁 */
  destroy(): void {
    this.disableHandsfree()
  }
}
