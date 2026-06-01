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
 * @see VADDetector - 自适应语音活动检测
 * @see StateMachine - 状态转换守卫
 * @see Session - 单次录音会话
 */

import { AudioHub } from './AudioHub'
import { StateMachine } from './StateMachine'
import { Session } from './Session'
import { VADDetector } from './VADDetector'
import { createASRProvider } from '../asr/factory'
import type { PcmFrame, PanelState, UIStateListener, VoiceUIState } from '../types/panel'
import type { VoiceDictationSettings } from '@/types/settings'
import { UnifiedIntelligenceDetector } from '../../../voice-dictation/core/UnifiedIntelligenceDetector'
import { AgentStateMonitor } from '../../../voice-dictation/core/AgentStateMonitor'
import type { UnifiedASRResult } from '../../../voice-dictation/types/intelligence'
import { createLogger } from '../../../voice-dictation/utils/logger'

export class Orchestrator {
  /** AudioHub 单例：麦克风 PCM 采集 */
  readonly hub = new AudioHub()
  /** 状态机：6 状态严格守卫 */
  readonly fsm = new StateMachine()
  /** 自适应语音活动检测器 */
  readonly vad = new VADDetector()

  // 🎯 新增：智能组件
  /** 统一智能检测器 */
  readonly detector = new UnifiedIntelligenceDetector()
  /** Agent状态监听器 */
  readonly agentMonitor = new AgentStateMonitor()

  /** 当前活跃的 Session（录音会话），无录音时为 null */
  private session: Session | null = null

  /** 🎯 当前Agent会话ID（用于打断操作） */
  private currentAgentSessionId: string | null = null
  /** 当前语音设置快照 */
  private settings: VoiceDictationSettings | null = null
  /** UI 状态监听器集合 */
  private uiListeners = new Set<UIStateListener>()
  /** VAD 订阅取消函数 */
  private unsubVAD: (() => void) | null = null
  /** 日志记录器 */
  private logger = createLogger('Orchestrator')

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
    this.vad.reset()
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
    this.volume = 0; this.vad.reset()
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
   * VAD 语音活动检测（由 PCM 帧订阅触发）
   *
   * 委托给 VADDetector 进行自适应阈值判断 + 挂尾保护。
   * onSpeechStart 时启动新录音会话。
   *
   * 仅在 listening 状态下运行
   *
   * @see VADDetector - 自适应算法细节
   */
  private detectSpeech(frame: PcmFrame): void {
    if (this.fsm.state !== 'listening') return

    const volume = frame.peak
    this.vad.process(frame)

    // 🎯 新增：详细的VAD检测日志
    this.logger.debug('VAD检测结果', {
      volume: volume.toFixed(4),
      isSpeaking: this.vad.isSpeaking,
      onSpeechStart: this.vad.onSpeechStart,
      onSpeechEnd: this.vad.onSpeechEnd
    })

    if (this.vad.onSpeechStart) {
      this.logger.info('VAD检测到语音开始，启动录音会话')
      this.startSession()
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
   *   3. 创建 Session 实例，传入 VADDetector + provider + Orchestrator 回调
   *   4. session.start() 启动 ASR
   *
   * 回调链（Session → Orchestrator）：
   *   onVolume → 更新音量 → emit
   *   onTranscript → 智能决策判断 → emit
   *   onMetadata → 更新消息 → emit
   *   onComplete → 通知自动发送 → FSM stopped → 2s 后自动回 listening（免提模式）
   *   onError → FSM error → 2s 后自动恢复
   */
  private startSession(): void {
    // 清理旧 Session（防止并发）
    if (this.session) { this.session.cancel(); this.session = null }
    if (!this.fsm.transition('recording')) return
    if (!this.settings) return

    this.logger.info('启动新录音会话', { engine: this.settings.engine })
    this.transcript = ''; this.message = '正在监听...'
    this.emit()

    const engine = this.settings.engine || 'doubao'
    const provider = createASRProvider(engine)

    const session = new Session(
      (sub) => this.hub.subscribe(sub),
      this.vad,
      provider,
      this.settings,
      {
        onVolume: (p: number) => {
          this.volume = p
          this.emit()
        },

        // 🎯 新增：集成智能决策
        onTranscript: (text: string, isFinal?: boolean) => {
          this.transcript = text
          this.emit()

          this.logger.info('收到语音转写结果', {
            text: text.substring(0, 20) + (text.length > 20 ? '...' : ''),
            isFinal,
            engine: this.settings?.engine
          })

          // 使用统一检测器判断是否需要发送
          const asrResult: UnifiedASRResult = {
            text,
            isFinal: isFinal || false,
            confidence: 0.8,
            isComplete: false, // 将由检测器判断
            asrType: this.settings?.engine || 'doubao',
            metadata: this.extractASRMetadata(provider)
          }

          // 获取当前Agent上下文
          const agentContext = this.agentMonitor.getCurrentContext()

          this.logger.debug('智能决策输入', {
            asrType: asrResult.asrType,
            agentLoopState: agentContext.loopState,
            canAcceptInput: agentContext.canAcceptInput
          })

          // 进行智能决策
          const decision = this.detector.makeIntelligentDecision(
            asrResult,
            agentContext
          )

          this.logger.info('智能决策结果', {
            shouldSend: decision.shouldSend,
            sendStrategy: decision.sendStrategy,
            confidence: decision.confidence.toFixed(2),
            reasoning: decision.reasoning
          })

          // 根据决策结果处理
          if (decision.shouldSend) {
            if (decision.sendStrategy === 'interrupt') {
              this.logger.warn('检测到即时指令，准备处理', { text })
              this.handleImmediateCommand(text, decision.reasoning)
            } else if (decision.sendStrategy === 'immediate') {
              this.logger.info('立即发送文本到Agent', { text })
              // 🎯 真正实现发送逻辑
              this.sendToAgent(text, decision.reasoning)
            } else if (decision.sendStrategy === 'wait') {
              this.logger.info('等待Agent空闲后发送', { text })
              // 排队等待逻辑 - 暂时简化为立即发送
              this.sendToAgent(text, 'Agent忙碌，但仍尝试发送')
            } else if (decision.sendStrategy === 'continue') {
              this.logger.info('语音未完成，继续等待')
              // 不发送，继续录音
            }
          }
        },

        onMetadata: (m: string) => {
          this.message = m
          this.emit()
          this.logger.debug('收到元数据更新', { message: m })
        },

        onComplete: (result) => {
          this.session = null
          this.message = result.commitMessage
          this.emit()

          this.logger.info('录音会话完成', {
            textLength: result.text.length,
            commitMessage: result.commitMessage,
            note: '发送由智能决策控制，此处不再重复发送'
          })

          // 完成 → 暂时回归 stopped
          this.fsm.transition('stopped')
          this.emit()
          // 2s 后自动回归 listening（免提模式持续监听下一轮语音）
          setTimeout(() => {
            if (this.settings?.handsfreeEnabled) {
              this.volume = 0; this.transcript = ''; this.message = ''
              this.fsm.transition('listening')
              this.emit()
              this.logger.info('自动回归listening状态，准备下一轮录音')
            }
          }, 2000)
        },

        onError: (m: string) => {
          this.session = null
          this.fsm.transition('error')
          this.message = m
          this.emit()

          this.logger.error('录音会话错误', { message: m })

          // 2s 后自动恢复
          setTimeout(() => {
            this.fsm.transition('stopped')
            if (this.settings?.handsfreeEnabled) this.fsm.transition('listening')
            this.emit()
            this.logger.info('从错误状态自动恢复')
          }, 2000)
        },
      },
    )

    this.session = session
    session.start().catch((error) => {
      this.logger.error('启动ASR失败', { error })
    })
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
    this.logger.info('销毁Orchestrator')
    this.agentMonitor.dispose()
    this.disableHandsfree()
  }

  // ════════════════════════════════════════
  //  智能决策辅助方法
  // ════════════════════════════════════════

  /**
   * 提取ASR元数据
   *
   * 根据不同的ASR引擎提取详细的元数据信息
   */
  private extractASRMetadata(provider: any): any {
    const metadata: any = {}

    // 如果是豆包ASR，尝试获取definite信息
    if (this.settings?.engine === 'doubao' && provider.getCurrentRecognitionDetails) {
      try {
        const details = provider.getCurrentRecognitionDetails()
        metadata.definite = details.definite
        metadata.utterances = details.utterances || []

        this.logger.debug('豆包ASR详细信息', {
          definite: details.definite,
          utterancesCount: details.utterances?.length || 0
        })
      } catch (error) {
        this.logger.warn('获取豆包ASR详细信息失败', { error })
      }
    }

    // WebSpeech的元数据（如果有的话）
    if (this.settings?.engine === 'webspeech' && provider.getCurrentResult) {
      try {
        const result = provider.getCurrentResult()
        metadata.interimText = result.interimText
        metadata.resultIndex = result.resultIndex

        this.logger.debug('WebSpeech详细信息', {
          interimText: result.interimText,
          resultIndex: result.resultIndex
        })
      } catch (error) {
        this.logger.warn('获取WebSpeech详细信息失败', { error })
      }
    }

    return metadata
  }

  /**
   * 🎯 处理即时指令（真正打断Agent执行）
   *
   * 当检测到即时指令（如"撤销"、"停止"等）时的特殊处理逻辑
   */
  private handleImmediateCommand(command: string, reasoning: string): void {
    this.logger.warn('🚨 处理即时指令 - 准备打断Agent', { command, reasoning })

    // 示例：根据不同的指令类型执行不同的操作
    if (command.includes('撤销') || command.includes('取消')) {
      this.logger.info('🚫 执行取消操作 - 打断Agent并停止录音')

      // 🎯 真正打断Agent执行
      if (this.currentAgentSessionId) {
        this.logger.info('🎯 调用stopAgent打断Agent', { sessionId: this.currentAgentSessionId })
        window.electronAPI.stopAgent(this.currentAgentSessionId).catch((error) => {
          this.logger.error('❌ 打断Agent失败', {
            error: error instanceof Error ? error.message : '未知错误',
            sessionId: this.currentAgentSessionId
          })
        })
        this.logger.info('✅ Agent已被打断')
      } else {
        this.logger.warn('⚠️ 没有sessionId，无法打断Agent')
      }

      // 停止当前录音会话
      this.cancelSession()

    } else if (command.includes('停止') || command.includes('停下')) {
      this.logger.info('🛑 执行停止操作 - 打断Agent并停止录音')

      // 🎯 真正打断Agent执行
      if (this.currentAgentSessionId) {
        this.logger.info('🎯 调用stopAgent停止Agent', { sessionId: this.currentAgentSessionId })
        window.electronAPI.stopAgent(this.currentAgentSessionId).catch((error) => {
          this.logger.error('❌ 停止Agent失败', {
            error: error instanceof Error ? error.message : '未知错误',
            sessionId: this.currentAgentSessionId
          })
        })
        this.logger.info('✅ Agent已被停止')
      } else {
        this.logger.warn('⚠️ 没有sessionId，无法停止Agent')
      }

      // 停止录音
      this.stopRecording()

    } else {
      this.logger.info('🤔 其他即时指令，准备特殊处理')
      // 其他即时指令的处理逻辑
    }

    this.logger.info('✅ 即时指令处理完成')
  }

  /**
   * 更新Agent状态（由外部调用）
   *
   * 允许外部组件更新Agent状态信息，用于智能决策
   */
  updateAgentState(state: {
    mode?: 'agent' | 'chat'
    status?: string
    streamingState?: { running: boolean; content: string; toolActivities: string[] }
    hasError?: boolean
    recentMessages?: string[]
    lastUserMessageTime?: number
  }): void {
    this.agentMonitor.updateAgentState(state)
    this.logger.debug('Agent状态已更新', {
      mode: state.mode,
      status: state.status,
      hasError: state.hasError
    })
  }

  /**
   * 🎯 发送语音到Agent（新增）
   *
   * 真正实现语音文本发送到Agent会话
   * 与现有的onAutoSend机制集成
   */
  private sendToAgent(text: string, reasoning: string): void {
    this.logger.info('🎯 开始发送语音到Agent', { text: text.substring(0, 20) + '...', reasoning })

    try {
      // 使用现有的onAutoSend机制进行发送
      this.onAutoSend?.(text)
      this.logger.info('✅ 语音已成功发送到Agent', {
        textLength: text.length,
        reasoning
      })
    } catch (error) {
      this.logger.error('❌ 发送语音到Agent失败', {
        error: error instanceof Error ? error.message : '未知错误',
        text: text.substring(0, 20) + '...'
      })
    }
  }

  /**
   * 添加最近消息（由外部调用）
   *
   * 允许外部组件添加最近的Agent消息，用于上下文分析
   */
  addRecentMessage(message: string): void {
    this.agentMonitor.addRecentMessage(message)
    this.logger.debug('最近消息已添加', {
      message: message.substring(0, 20) + '...'
    })
  }

  /**
   * 🎯 设置当前Agent会话ID（由外部调用）
   *
   * 允许外部组件设置当前Agent会话ID，用于打断操作
   */
  setCurrentAgentSessionId(sessionId: string | null): void {
    this.currentAgentSessionId = sessionId
    this.logger.debug('Agent会话ID已更新', { sessionId })
  }

  /**
   * 🎯 获取当前Agent会话ID
   */
  getCurrentAgentSessionId(): string | null {
    return this.currentAgentSessionId
  }
}
