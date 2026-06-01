/**
 * 语音模块 — Orchestrator 总调度器
 *
 * 语音模块的中枢，管理所有子组件之间的协调和状态流转。
 *
 * 核心职责：
 *   1. 持有 AudioHub 单例（麦克风 PCM 采集）
 *   2. 持有 StateMachine（状态转换守卫）
 *   3. 订阅 AudioHub PCM 帧 → VAD 语音活动检测
 *   4. 创建/销毁 Session（单次录音会话）
 *   5. 管理免提开关（开启/关闭/切换）
 *   6. 广播 VoiceUIState 给 React 表示层
 *   7. 提供 onAutoSend 回调出口（转写文本输出到 Agent/Chat 输入框）
 *
 * 状态机生命周期：
 *   stopped ──[enableHandsfree]──→ listening ──[VAD 检测到语音]──→ recording
 *       ↑                              ↑                              ↓
 *       └──[disableHandsfree]──────────┘      processing ←[静音/手动]─┘
 *                                              ↓        ↓
 *                                         completed   error
 *                                              ↓        ↓
 *                                           stopped ←──┘
 *
 * @see AudioHub - PCM 帧来源
 * @see StateMachine - 状态转换守卫
 * @see Session - 单次录音会话
 */

import { AudioHub } from './AudioHub'
import { StateMachine } from './StateMachine'
import { Session } from './Session'
import { createASRProvider } from '../asr/factory'
import type { PcmFrame, PanelState, UIStateListener, VoiceUIState } from '../types/panel'
import type { VoiceDictationSettings } from '../../../../types'

export class Orchestrator {
  /** AudioHub 单例：麦克风 PCM 采集 */
  readonly hub = new AudioHub()
  /** 状态机：6 状态严格守卫 */
  readonly fsm = new StateMachine()
  /** 当前活跃的 Session（录音会话），无录音时为 null */
  private session: Session | null = null
  /** 当前语音设置快照 */
  private settings: VoiceDictationSettings | null = null
  /** UI 状态监听器集合 */
  private uiListeners = new Set<UIStateListener>()
  /** VAD 订阅取消函数 */
  private unsubVAD: (() => void) | null = null

  /**
   * 自动发送回调——由 React 层（VoiceFloatingPanel）注入
   *
   * Session 完成时调用，将语音转写文本发送到当前活跃的 Agent/Chat 会话。
   * 注入位置见 VoiceFloatingPanel.useEffect → orch.onAutoSend = ...
   */
  onAutoSend: ((text: string) => void) | null = null

  // ██ UI 状态缓存 ██

  /** 当前音量（0-1），由 PCM 帧更新 */
  private volume = 0
  /** 当前转写文本 */
  private transcript = ''
  /** 当前状态描述消息 */
  private message = ''

  // ██ VAD 检测状态 ██

  /** 连续满足能量阈值的 PCM 帧计数 */
  private consecutiveFrames = 0
  /** 最近一次触发录音的时间戳（防抖 2s） */
  private lastTrigger = 0

  /**
   * 广播当前 UI 状态给所有监听器
   *
   * 状态变更的出口——任何内部状态变化最终都通过此方法通知 React 层。
   * 单个监听器异常不影响其他监听器。
   */
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

  /**
   * 订阅 UI 状态变更
   *
   * @param fn - 状态监听器，每次 emit() 时收到最新 VoiceUIState
   * @returns 取消订阅函数
   */
  onUIState(fn: UIStateListener): () => void {
    this.uiListeners.add(fn)
    return () => { this.uiListeners.delete(fn) }
  }

  // ════════════════════════════════════════
  //  免提开关管理
  // ════════════════════════════════════════

  /**
   * 开启免提模式
   *
   * 流程：
   *   1. FSM: stopped → listening
   *   2. 启动 AudioHub（getUserMedia 获取麦克风）
   *   3. 订阅 PCM 帧 → VAD 检测
   *
   * 麦克风不可用时回退到 stopped，发出错误消息。
   */
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

    // 挂载 VAD 检测：每次 PCM 帧都检测语音活动
    this.unsubVAD = this.hub.subscribe((frame: PcmFrame) => {
      this.volume = frame.peak
      this.emit()
      this.detectSpeech(frame)
    })

    this.message = ''
    this.emit()
  }

  /**
   * 关闭免提模式
   *
   * 清理顺序：取消 Session → 取消 VAD 订阅 → 停止 AudioHub → 重置状态
   */
  disableHandsfree(): void {
    this.cancelSession()
    this.unsubVAD?.(); this.unsubVAD = null
    this.hub.stop()
    this.volume = 0; this.consecutiveFrames = 0
    this.fsm.transition('stopped')
    this.message = ''
    this.emit()
  }

  /**
   * 根据设置切换免提模式开关
   *
   * @param settings - 语音设置（handsfreeEnabled + enabled 同时为 true 才开启）
   */
  async toggleHandsfree(settings: VoiceDictationSettings): Promise<void> {
    this.settings = settings
    if (settings.handsfreeEnabled && settings.enabled) {
      await this.enableHandsfree()
    } else {
      this.disableHandsfree()
    }
  }

  // ════════════════════════════════════════
  //  VAD 语音活动检测
  // ════════════════════════════════════════

  /**
   * VAD 语音活动检测
   *
   * 阈值：peak >= 0.02 视为"有语音"
   * 防抖：两次触发间隔 >= 2000ms
   * 瞬时保护：连续帧计数（暂设为 1 帧即触发，可调大减少误触发）
   *
   * 仅在 listening 状态下运行
   */
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
      // 不满足条件时重置连续帧计数
      this.consecutiveFrames = 0
    }
  }

  // ════════════════════════════════════════
  //  Session 管理
  // ════════════════════════════════════════

  /**
   * 启动新录音会话（由 VAD 或手动触发）
   *
   * 流程：
   *   1. 如果已有活跃 Session，先取消它
   *   2. FSM: listening → recording
   *   3. 创建 Session 实例，传入 Orchestrator 回调
   *   4. session.start() 启动 ASR
   *
   * 回调链（Session → Orchestrator）：
   *   onVolume → 更新音量 → emit
   *   onTranscript → 更新转写文本 → emit
   *   onMetadata → 更新消息 → emit
   *   onComplete → 通知自动发送 → FSM stopped → 2s 后自动回 listening（免提模式）
   *   onError → FSM error → 2s 后自动恢复
   */
  private startSession(): void {
    // 清理旧 Session（防止并发）
    if (this.session) { this.session.cancel(); this.session = null }
    if (!this.fsm.transition('recording')) return
    if (!this.settings) return

    this.transcript = ''; this.message = '正在监听...'
    this.emit()

    const engine = this.settings.engine || 'doubao'
    const provider = createASRProvider(engine)

    const session = new Session(
      (sub) => this.hub.subscribe(sub),
      provider,
      this.settings,
      {
        onVolume: (p: number) => { this.volume = p; this.emit() },
        onTranscript: (t: string) => { this.transcript = t; this.emit() },
        onMetadata: (m: string) => { this.message = m; this.emit() },
        onComplete: (result) => {
          this.session = null
          this.message = result.commitMessage
          this.emit()

          // 自动发送转写文本到 Agent/Chat 会话
          if (result.text) {
            this.onAutoSend?.(result.text)
          }

          // 完成 → 暂时回归 stopped
          this.fsm.transition('stopped')
          this.emit()
          // 2s 后自动回归 listening（免提模式持续监听下一轮语音）
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
          // 2s 后自动恢复
          setTimeout(() => {
            this.fsm.transition('stopped')
            if (this.settings?.handsfreeEnabled) this.fsm.transition('listening')
            this.emit()
          }, 2000)
        },
      },
    )

    this.session = session
    session.start().catch(() => {})
  }

  /** 取消失去活跃的 Session（幂等） */
  private cancelSession(): void {
    if (this.session) {
      this.session.cancel()
      this.session = null
    }
  }

  /**
   * 手动停止录音（快捷键触发）
   *
   * 仅在 recording 状态下有效。
   * 在免提模式下用于手动结束一轮录音（不等 VAD 静音超时）。
   */
  async stopRecording(): Promise<void> {
    if (this.fsm.state !== 'recording') return
    if (!this.session) return
    const text = await this.session.stop().catch(() => '')
    this.transcript = text
  }

  /**
   * 销毁 Orchestrator，释放所有资源
   *
   * 清理顺序：关闭免提 → 停止 AudioHub → 取消所有订阅
   */
  destroy(): void {
    this.disableHandsfree()
  }
}
