/**
 * 【第 4 层 - 业务模块层】语音状态投影模块（唯一状态写入口）
 *
 * 职责：管理 UI 状态机，提供 UI 状态订阅接口
 */

import type { VoiceDictationSettings } from '@/types/settings'
import type { UIStateListener } from '../../shared/types/panel'
import type { IntelligentDecision } from '../../shared/types/intelligence'
import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../../shared/bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../../shared/bus/VoiceDomainEventKeys'
import { VoiceState, VoiceStateMachine } from '../state/VoiceStateMachine'
import { StateTransitionQueue } from '../state/StateTransitionQueue'
import type { StateTransitionContext } from '../state/VoiceStateMachine'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceRuntimeStateModule extends BaseVoiceModule {
  /** 语音状态机（唯一 UI 状态投影来源） */
  private readonly stateMachine = new VoiceStateMachine()
  /** 转换队列（保证状态迁移时序） */
  private readonly transitionQueue = new StateTransitionQueue(this.stateMachine)
  /** 错误恢复计时器 */
  private recoverTimer: ReturnType<typeof setTimeout> | null = null

  /** 当前设置快照 */
  private settings: VoiceDictationSettings | null = null
  /** 当前 Agent 会话 ID */
  private currentAgentSessionId: string | null = null
  /** 转写文本投影 */
  private transcript = ''
  /** 状态消息投影 */
  private message = ''
  /** 音量投影 */
  private volume = 0

  constructor(
    bus: VoiceDomainEventBus,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, ({ settings }) => {
      this.settings = settings
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.setAgentSessionId, ({ sessionId }) => {
      this.currentAgentSessionId = sessionId
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.handsfree.enabled, ({ settings }) => {
      this.settings = settings
      this.stateMachine.transition(VoiceState.LISTENING, this.createTransitionContext('开启免提模式'))
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.handsfree.disabled, () => {
      this.stateMachine.transition(VoiceState.STOPPED, this.createTransitionContext('关闭免提模式'))
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.handsfree.failed, ({ message }) => {
      this.stateMachine.transition(
        VoiceState.STOPPED,
        this.createTransitionContext('麦克风不可用', { message }),
      )
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.started, () => {
      this.transcript = ''
      this.message = '正在监听...'
      this.stateMachine.transition(
        VoiceState.RECORDING,
        this.createTransitionContext('启动录音会话', {
          transcript: '',
          message: '正在监听...',
        }),
      )
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.volume, ({ peak }) => {
      this.volume = peak
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.transcript, ({ text }) => {
      this.transcript = text
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.metadata, ({ message }) => {
      this.message = message
      this.stateMachine.transition(
        this.stateMachine.getCurrentState(),
        this.createTransitionContext('元数据更新', { message }),
      )
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.complete, ({ text, commitMessage }) => this.handleSessionComplete(text, commitMessage))
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.error, ({ message }) => this.handleSessionError(message))
    this.on(VOICE_DOMAIN_EVENT_KEYS.decision.feedback, ({ reasoning, strategy }) =>
      this.applyDecisionFeedback(reasoning, strategy),
    )
  }

  /**
   * 订阅 UI 状态
   */
  onUIState(listener: UIStateListener): () => void {
    return this.stateMachine.onStateChange(listener)
  }

  /**
   * 由命令执行模块写入文本/消息
   */
  setTranscriptAndMessage(transcript: string, message: string): void {
    this.transcript = transcript
    this.message = message
  }

  /**
   * 构造状态转换上下文
   */
  createTransitionContext(reason: string, overrides?: Partial<StateTransitionContext>): StateTransitionContext {
    return {
      sessionId: this.currentAgentSessionId,
      transcript: this.transcript,
      message: this.message,
      volume: this.volume,
      settings: this.settings,
      reason,
      ...overrides,
    }
  }

  /**
   * 立即状态迁移（高优先级）
   */
  immediateTransition(targetState: VoiceState, context: StateTransitionContext, priority = 0): void {
    this.transitionQueue.enqueue(targetState, context, 0, priority)
  }

  /**
   * 延迟状态迁移
   */
  delayedTransition(
    targetState: VoiceState,
    context: StateTransitionContext,
    delayMs: number,
    priority = 0,
  ): void {
    this.transitionQueue.enqueue(targetState, context, delayMs, priority)
  }

  /**
   * 获取当前状态机状态
   */
  getCurrentState(): VoiceState {
    return this.stateMachine.getCurrentState()
  }

  /**
   * 是否启用免提
   */
  isHandsfreeEnabled(): boolean {
    return this.settings?.handsfreeEnabled === true
  }

  /**
   * 释放状态模块资源
   */
  dispose(): void {
    this.disposeSubscriptions()
    this.transitionQueue.dispose()
    this.stateMachine.dispose()
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer)
      this.recoverTimer = null
    }
  }

  /**
   * 应用决策反馈到状态投影
   */
  private applyDecisionFeedback(
    reasoning: string,
    strategy: IntelligentDecision['sendStrategy'],
  ): void {
    const feedbackByStrategy: Record<IntelligentDecision['sendStrategy'], string> = {
      continue: '语音识别中...',
      interrupt: '检测到即时指令',
      immediate: '正在发送...',
      wait: '等待Agent空闲...',
    }
    this.message = feedbackByStrategy[strategy] ?? reasoning
    this.stateMachine.transition(
      this.stateMachine.getCurrentState(),
      this.createTransitionContext('智能决策结果', {
        message: reasoning,
        extra: { sendStrategy: strategy },
      }),
    )
  }

  /**
   * 会话完成后的状态流转
   */
  private handleSessionComplete(text: string, commitMessage: string): void {
    this.message = commitMessage

    if (this.transcript === '' && text === '') {
      this.stateMachine.transition(
        VoiceState.COMPLETED,
        this.createTransitionContext('录音会话完成', {
          transcript: text,
          message: commitMessage,
          extra: { note: '录音会话完成，无内容' },
        }),
      )
    }

    this.stateMachine.transition(
      VoiceState.STOPPED,
      this.createTransitionContext('录音完成', {
        transcript: text,
        message: commitMessage,
        extra: { note: '发送由智能决策控制，此处不再重复发送' },
      }),
    )

    if (this.isHandsfreeEnabled()) {
      this.logger.info('免提模式：立即回归listening状态')
      this.stateMachine.transition(
        VoiceState.LISTENING,
        this.createTransitionContext('免提模式自动回归', {
          volume: 0,
          transcript: '',
          message: '',
        }),
      )
    }
  }

  /**
   * 会话错误后的自动恢复
   */
  private handleSessionError(message: string): void {
    this.stateMachine.transition(
      VoiceState.ERROR,
      this.createTransitionContext('录音会话错误', { message }),
    )
    if (this.recoverTimer) clearTimeout(this.recoverTimer)
    this.recoverTimer = setTimeout(() => {
      this.stateMachine.transition(
        VoiceState.STOPPED,
        this.createTransitionContext('从错误状态自动恢复'),
      )
      if (this.isHandsfreeEnabled()) {
        this.stateMachine.transition(
          VoiceState.LISTENING,
          this.createTransitionContext('免提模式自动恢复'),
        )
      }
      this.logger.info('从错误状态自动恢复')
      this.recoverTimer = null
    }, 2000)
  }
}
