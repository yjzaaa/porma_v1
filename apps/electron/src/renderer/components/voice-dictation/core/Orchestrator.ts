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
import { VoiceStateMachine, VoiceState } from './VoiceStateMachine'
import { StateTransitionQueue } from './StateTransitionQueue'
import { Session } from './Session'
import { VADDetector } from './VADDetector'
import { createASRProvider } from '../asr/factory'
import type { PcmFrame, PanelState, UIStateListener, VoiceUIState } from '../types/panel'
import type { VoiceDictationSettings } from '@/types/settings'
import type { StateTransitionContext } from './VoiceStateMachine'
import { UnifiedIntelligenceDetector } from './UnifiedIntelligenceDetector'
import { AgentStateMonitor } from './AgentStateMonitor'
import type { UnifiedASRResult } from '../types/intelligence'
import { createLogger } from '../utils/logger'

export class Orchestrator {
  /** AudioHub 单例：麦克风 PCM 采集 */
  readonly hub = new AudioHub()
  /** 语音状态机：状态模式+策略模式实现 */
  readonly voiceStateMachine = new VoiceStateMachine()
  /** 🎯 状态转换队列：确保状态转换严格排队执行 */
  readonly stateTransitionQueue = new StateTransitionQueue(this.voiceStateMachine)
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
   * 订阅 UI 状态变更
   *
   * @param fn - 状态监听器，每次状态变更时收到最新 VoiceUIState
   * @returns 取消订阅函数
   */
  onUIState(fn: UIStateListener): () => void {
    return this.voiceStateMachine.onStateChange(fn)
  }

  // ════════════════════════════════════════
  //  免提开关管理
  // ════════════════════════════════════════

  /**
   * 开启免提模式
   *
   * 流程：
   *   1. 状态转换: stopped → listening
   *   2. 启动 AudioHub（getUserMedia 获取麦克风）
   *   3. 订阅 PCM 帧 → VAD 检测
   *
   * 麦克风不可用时回退到 stopped，发出错误消息。
   */
  async enableHandsfree(): Promise<void> {
    const context = this.createTransitionContext('开启免提模式')

    if (this.voiceStateMachine.getCurrentState() === VoiceState.LISTENING) {
      this.logger.debug('已经在listening状态，跳过')
      return
    }

    this.voiceStateMachine.transition(VoiceState.LISTENING, context)
    this.vad.reset()

    try {
      await this.hub.start()
    } catch (err) {
      this.logger.error('麦克风启动失败', { error: err })
      this.voiceStateMachine.transition(VoiceState.STOPPED, {
        ...context,
        reason: '麦克风不可用',
        message: '麦克风不可用'
      })
      return
    }

    // 挂载 VAD 检测：每次 PCM 帧都检测语音活动
    this.unsubVAD = this.hub.subscribe((frame: PcmFrame) => {
      this.detectSpeech(frame)
    })
  }

  /**
   * 关闭免提模式
   *
   * 清理顺序：取消 Session → 取消 VAD 订阅 → 停止 AudioHub → 重置状态
   */
  disableHandsfree(): void {
    const context = this.createTransitionContext('关闭免提模式')

    this.cancelSession()
    this.unsubVAD?.(); this.unsubVAD = null
    this.hub.stop()
    this.vad.reset()

    this.voiceStateMachine.transition(VoiceState.STOPPED, context)
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
    if (this.voiceStateMachine.getCurrentState() !== VoiceState.LISTENING) return

    this.vad.process(frame)
    const context = this.createTransitionContext('VAD检测')

    // 🎯 新增：详细的VAD检测日志
    this.logger.debug('VAD检测结果', {
      volume: frame.peak.toFixed(4),
      isSpeaking: this.vad.isSpeaking,
      onSpeechStart: this.vad.onSpeechStart,
      onSpeechEnd: this.vad.onSpeechEnd
    })

    if (this.vad.onSpeechStart) {
      this.logger.info('VAD检测到语音开始，启动录音会话')
      this.startSession(context)
    }
  }

  // ════════════════════════════════════════
  //  状态转换上下文创建辅助方法
  // ════════════════════════════════════════

  /**
   * 创建状态转换上下文
   */
  private createTransitionContext(
    reason: string,
    overrides?: Partial<StateTransitionContext>
  ): StateTransitionContext {
    return {
      sessionId: this.currentAgentSessionId,
      transcript: this.transcript,
      message: this.message,
      volume: this.volume,
      settings: this.settings,
      reason,
      ...overrides
    }
  }

  // ════════════════════════════════════════
  // 状态转换队列辅助方法
  // ════════════════════════════════════════

  /**
   * 立即状态转换（优先级高）
   */
  private immediateTransition(
    targetState: VoiceState,
    context: StateTransitionContext,
    priority: number = 0
  ): void {
    this.stateTransitionQueue.enqueue(targetState, context, 0, priority)
  }

  /**
   * 延迟状态转换
   */
  private delayedTransition(
    targetState: VoiceState,
    context: StateTransitionContext,
    delayMs: number,
    priority: number = 0
  ): void {
    this.stateTransitionQueue.enqueue(targetState, context, delayMs, priority)
  }

  /**
   * 清空状态转换队列
   */
  private clearTransitionQueue(): void {
    this.stateTransitionQueue.clear()
  }

  /**
   * 检查队列是否活跃
   */
  private isTransitionQueueActive(): boolean {
    return this.stateTransitionQueue.isActive()
  }

  // ════════════════════════════════════════
  //  Session 管理
  // ════════════════════════════════════════

  /**
   * 启动新录音会话（由 VAD 或手动触发）
   *
   * 流程：
   *   1. 如果已有活跃 Session，先取消它
   *   2. 状态转换: listening → recording
   *   3. 创建 Session 实例，传入 VADDetector + provider + Orchestrator 回调
   *   4. session.start() 启动 ASR
   *
   * 回调链（Session → Orchestrator）：
   *   onVolume → 更新音量 → 状态转换
   *   onTranscript → 智能决策判断 → 状态转换
   *   onMetadata → 更新消息 → 状态转换
   *   onComplete → 通知自动发送 → 状态转换 → 免提模式下自动回listening
   *   onError → 状态转换 → 2s 后自动恢复
   */
  private startSession(context: StateTransitionContext): void {
    // 清理旧 Session（防止并发）
    if (this.session) { this.session.cancel(); this.session = null }
    if (!this.settings) return

    this.logger.info('启动新录音会话', { engine: this.settings.engine })
    this.transcript = ''; this.message = '正在监听...'

    // 状态转换：listening → recording
    this.voiceStateMachine.transition(VoiceState.RECORDING, {
      ...context,
      transcript: '',
      message: '正在监听...'
    })

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
          // 音量更新不需要状态转换，只更新内部状态
        },

        // 🎯 新增：集成智能决策
        onTranscript: (text: string, isFinal?: boolean) => {
          this.transcript = text
          // 转录更新不需要立即emit，让智能决策来驱动状态变更

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

          // 🎯 根据决策结果更新UI状态
          if (decision.sendStrategy === 'continue') {
            this.message = '语音识别中...'
          } else if (decision.sendStrategy === 'interrupt') {
            this.message = '检测到即时指令'
          } else if (decision.sendStrategy === 'immediate') {
            this.message = '正在发送...'
          } else if (decision.sendStrategy === 'wait') {
            this.message = '等待Agent空闲...'
          } else {
            this.message = decision.reasoning
          }

          // 🎯 通过状态机确保UI能及时反映智能决策结果
          this.voiceStateMachine.transition(
            this.voiceStateMachine.getCurrentState(),
            this.createTransitionContext('智能决策结果', {
              message: decision.reasoning,
              extra: { sendStrategy: decision.sendStrategy }
            })
          )
          this.logger.debug('智能决策后状态更新', {
            message: this.message,
            sendStrategy: decision.sendStrategy
          })

          // 根据决策结果处理
          if (decision.shouldSend) {
            if (decision.sendStrategy === 'interrupt') {
              this.logger.warn('检测到即时指令，准备处理', { text })

              // 🎯 先显示"检测到指令"状态，给用户即时反馈
              const currentState = this.voiceStateMachine.getCurrentState()
              if (currentState !== VoiceState.PROCESSING) {
                this.immediateTransition(
                  VoiceState.PROCESSING,
                  this.createTransitionContext('检测到即时指令', {
                    transcript: this.transcript,
                    message: '检测到指令...'
                  }),
                  10  // 高优先级
                )
              }

              this.handleImmediateCommand(text, decision.reasoning)
            } else if (decision.sendStrategy === 'immediate') {
              this.logger.info('立即发送文本到Agent', { text })

              // 🎯 先显示"准备发送"状态，让用户看到即将发送的内容
              this.immediateTransition(
                VoiceState.PROCESSING,
                this.createTransitionContext('准备发送', {
                  transcript: this.transcript,
                  message: '准备发送...'
                }),
                10  // 高优先级
              )

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
          this.voiceStateMachine.transition(
            this.voiceStateMachine.getCurrentState(),
            this.createTransitionContext('元数据更新', { message: m })
          )
          this.logger.debug('收到元数据更新', { message: m })
        },

        onComplete: (result) => {
          this.session = null
          this.message = result.commitMessage

          // 🎯 不立即转换到COMPLETED，等待智能决策结果
          // 状态转换将在onTranscript中的智能决策处理
          this.logger.info('录音会话完成，等待智能决策', {
            textLength: result.text.length,
            commitMessage: result.commitMessage
          })

          // 🎯 如果没有智能决策（如超时停止），则直接转换到COMPLETED
          // 这通过检查this.session是否为null来判断
          if (this.transcript === '' && result.text === '') {
            this.voiceStateMachine.transition(
              VoiceState.COMPLETED,
              this.createTransitionContext('录音会话完成', {
                transcript: result.text,
                message: result.commitMessage,
                extra: { note: '录音会话完成，无内容' }
              })
            )
          }

          // 完成 → 暂时回归 stopped
          this.voiceStateMachine.transition(
            VoiceState.STOPPED,
            this.createTransitionContext('录音完成', {
              transcript: result.text,
              message: result.commitMessage,
              extra: { note: '发送由智能决策控制，此处不再重复发送' }
            })
          )

          // 🎯 免提模式：立即回归listening（不再等待2秒）
          if (this.settings?.handsfreeEnabled) {
            this.logger.info('🔄 免提模式：立即回归listening状态')
            this.voiceStateMachine.transition(
              VoiceState.LISTENING,
              this.createTransitionContext('免提模式自动回归', {
                volume: 0,
                transcript: '',
                message: ''
              })
            )
          }
        },

        onError: (m: string) => {
          this.session = null
          this.voiceStateMachine.transition(
            VoiceState.ERROR,
            this.createTransitionContext('录音会话错误', {
              message: m
            })
          )

          this.logger.error('录音会话错误', { message: m })

          // 2s 后自动恢复
          setTimeout(() => {
            this.voiceStateMachine.transition(
              VoiceState.STOPPED,
              this.createTransitionContext('从错误状态自动恢复')
            )

            if (this.settings?.handsfreeEnabled) {
              this.voiceStateMachine.transition(
                VoiceState.LISTENING,
                this.createTransitionContext('免提模式自动恢复')
              )
            }

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
    if (this.voiceStateMachine.getCurrentState() !== VoiceState.RECORDING) return
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

      // 🎯 状态转换序列：PROCESSING (200ms) → COMPLETED (200ms) → LISTENING
      this.immediateTransition(
        VoiceState.PROCESSING,
        this.createTransitionContext('取消操作', {
          transcript: this.transcript,
          message: '正在取消...'
        }),
        10  // 高优先级，确保立即执行
      )

      this.logger.info('📝 显示取消处理中状态')

      // 🎯 200ms 后显示"已取消"状态
      this.delayedTransition(
        VoiceState.COMPLETED,
        this.createTransitionContext('取消操作', {
          transcript: '',
          message: '已取消'
        }),
        200,
        10  // 高优先级
      )

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

      this.logger.info('📝 取消操作后清空转录文本，立即停止录音')
      this.transcript = ''
      this.message = '已取消'

      this.stopRecording().catch(() => {
        this.logger.warn('停止录音会话失败或已完成')
      })

      // 免提模式下自动回归listening（COMPLETED 状态显示200ms后）
      if (this.settings?.handsfreeEnabled) {
        this.delayedTransition(
          VoiceState.LISTENING,
          this.createTransitionContext('免提模式自动回归', {
            volume: 0,
            transcript: '',
            message: ''
          }),
          400,  // 200ms (PROCESSING) + 200ms (COMPLETED) = 400ms 总时间
          10   // 高优先级
        )
      }

    } else if (command.includes('停止') || command.includes('停下')) {
      this.logger.info('🛑 执行停止操作 - 打断Agent并停止录音')

      // 🎯 状态转换序列：PROCESSING (200ms) → COMPLETED (200ms) → LISTENING
      this.immediateTransition(
        VoiceState.PROCESSING,
        this.createTransitionContext('停止操作', {
          transcript: this.transcript,
          message: '正在停止...'
        }),
        10  // 高优先级
      )

      this.logger.info('📝 显示停止处理中状态')

      // 🎯 200ms 后显示"已停止"状态
      this.delayedTransition(
        VoiceState.COMPLETED,
        this.createTransitionContext('停止操作', {
          transcript: '',
          message: '已停止'
        }),
        200,
        10  // 高优先级
      )

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

      // 🎯 真正打断Agent执行
      this.logger.info('📝 停止操作后清空转录文本，立即停止录音')
      this.transcript = ''
      this.message = '已停止'

      this.stopRecording().catch(() => {
        this.logger.warn('停止录音会话失败或已完成')
      })

      // 免提模式下自动回归listening（COMPLETED 状态显示200ms后）
      if (this.settings?.handsfreeEnabled) {
        this.delayedTransition(
          VoiceState.LISTENING,
          this.createTransitionContext('免提模式自动回归', {
            volume: 0,
            transcript: '',
            message: ''
          }),
          400,  // 200ms (PROCESSING) + 200ms (COMPLETED) = 400ms 总时间
          10   // 高优先级
        )
      }

    } else {
      this.logger.info('🤔 其他即时指令，执行通用打断逻辑')

      // 🎯 通用的即时指令处理：打断Agent
      if (this.currentAgentSessionId) {
        this.logger.info('🎯 调用stopAgent处理即时指令', { sessionId: this.currentAgentSessionId, command })
        window.electronAPI.stopAgent(this.currentAgentSessionId).catch((error) => {
          this.logger.error('❌ 处理即时指令失败', {
            error: error instanceof Error ? error.message : '未知错误',
            sessionId: this.currentAgentSessionId,
            command
          })
        })
        this.logger.info('✅ 即时指令处理完成 - Agent已被打断')
      } else {
        this.logger.warn('⚠️ 没有sessionId，无法处理即时指令')
      }

      // 停止当前录音会话
      this.cancelSession()

      // 🎯 先显示"正在处理"状态，给用户即时反馈
      this.voiceStateMachine.transition(
        VoiceState.PROCESSING,
        this.createTransitionContext('即时指令执行', {
          transcript: this.transcript,
          message: '正在处理指令...'
        })
      )

      // 🎯 通用的即时指令处理：打断Agent
      if (this.currentAgentSessionId) {
        this.logger.info('🎯 调用stopAgent处理即时指令', { sessionId: this.currentAgentSessionId, command })
        window.electronAPI.stopAgent(this.currentAgentSessionId).catch((error) => {
          this.logger.error('❌ 处理即时指令失败', {
            error: error instanceof Error ? error.message : '未知错误',
            sessionId: this.currentAgentSessionId,
            command
          })
        })
        this.logger.info('✅ 即时指令处理完成 - Agent已被打断')
      } else {
        this.logger.warn('⚠️ 没有sessionId，无法处理即时指令')
      }

      // 🎯 200ms 后显示"指令已执行"状态
      this.delayedTransition(
        VoiceState.COMPLETED,
        this.createTransitionContext('即时指令执行', {
          transcript: '',
          message: '指令已执行'
        }),
        200,
        10  // 高优先级
      )

      this.logger.info('📝 清空转录文本，立即停止录音')
      this.transcript = ''
      this.message = '指令已执行'

      this.stopRecording().catch(() => {
        this.logger.warn('停止录音会话失败或已完成')
      })

      // 免提模式下自动回归listening（COMPLETED 状态显示200ms后）
      if (this.settings?.handsfreeEnabled) {
        this.delayedTransition(
          VoiceState.LISTENING,
          this.createTransitionContext('免提模式自动回归', {
            volume: 0,
            transcript: '',
            message: ''
          }),
          400,  // 200ms (PROCESSING) + 200ms (COMPLETED) = 400ms 总时间
          10   // 高优先级
        )
      }
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

      // 🎯 发送后清空转录文本
      this.transcript = ''
      this.message = '已发送'

      // 🎯 快速显示"已发送"状态（200ms后），然后立即回到LISTENING
      this.delayedTransition(
        VoiceState.COMPLETED,
        this.createTransitionContext('发送完成', {
          transcript: '',
          message: '已发送'
        }),
        200,  // 200ms 后显示"已发送"
        10   // 高优先级
      )

      // 免提模式下快速回到LISTENING状态（总共显示400ms后）
      if (this.settings?.handsfreeEnabled) {
        this.delayedTransition(
          VoiceState.LISTENING,
          this.createTransitionContext('免提模式自动回归', {
            volume: 0,
            transcript: '',
            message: ''
          }),
          400,  // 200ms (准备发送) + 200ms (已发送) = 400ms 总时间
          10   // 高优先级
        )
      }

      this.logger.info('📝 发送后清空转录文本，立即停止录音')

      // 🎯 立即停止录音会话（会触发onComplete，自动回到listening）
      this.stopRecording().catch(() => {
        this.logger.warn('停止录音会话失败或已完成')
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
