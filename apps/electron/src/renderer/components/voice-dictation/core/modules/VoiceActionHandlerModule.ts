/**
 * 【第 4 层 - 业务模块层】动作处理模块（动作事件 -> 具体执行）
 *
 * 职责：执行发送文本、处理即时指令、停止 Agent
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../../shared/bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../../shared/bus/VoiceDomainEventKeys'
import { VoiceState } from '../state/VoiceStateMachine'
import { VoiceAgentModule } from './VoiceAgentModule'
import { VoiceCaptureModule } from './VoiceCaptureModule'
import { VoiceRuntimeStateModule } from './VoiceRuntimeStateModule'
import { BaseVoiceModule } from './BaseVoiceModule'

interface ImmediateActionConfig {
  reason: string
  processingMessage: string
  completedMessage: string
}

export class VoiceActionHandlerModule extends BaseVoiceModule {
  constructor(
    bus: VoiceDomainEventBus,
    private readonly stateModule: VoiceRuntimeStateModule,
    private readonly captureModule: VoiceCaptureModule,
    private readonly agentModule: VoiceAgentModule,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)
    this.on(VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText, ({ text, reasoning }) =>
      this.handleSendVoiceText(text, reasoning),
    )
    this.on(VOICE_DOMAIN_EVENT_KEYS.action.handleImmediateInstruction, ({ command, reasoning }) =>
      this.handleImmediateInstruction(command, reasoning),
    )
  }

  dispose(): void {
    this.disposeSubscriptions()
  }

  private handleSendVoiceText(text: string, reasoning: string): void {
    this.logger.info('🎯 ActionModule 收到发送文本事件', {
      textLength: text.length,
      reasoning,
    })
    this.logger.info('开始发送语音到Agent', {
      text: `${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`,
      reasoning,
    })

    this.stateModule.immediateTransition(
      VoiceState.PROCESSING,
      this.stateModule.createTransitionContext('准备发送', { message: '准备发送...' }),
      10,
    )

    try {
      this.emit(VOICE_DOMAIN_EVENT_KEYS.ui.autoSendRequested, { text })
      this.logger.info('语音已成功发送到Agent', { textLength: text.length, reasoning })

      this.stateModule.setTranscriptAndMessage('', '已发送')
      this.stateModule.delayedTransition(
        VoiceState.COMPLETED,
        this.stateModule.createTransitionContext('发送完成', {
          transcript: '',
          message: '已发送',
        }),
        200,
        10,
      )

      if (this.captureModule.isHandsfreeEnabled()) {
        this.stateModule.delayedTransition(
          VoiceState.LISTENING,
          this.stateModule.createTransitionContext('免提模式自动回归', {
            volume: 0,
            transcript: '',
            message: '',
          }),
          400,
          10,
        )
      }

      this.emit(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, undefined)
    } catch (error) {
      this.logger.error('发送语音到Agent失败', {
        error: error instanceof Error ? error.message : '未知错误',
      })
    }
  }

  private handleImmediateInstruction(command: string, reasoning: string): void {
    this.logger.warn('处理即时指令', { command, reasoning })

    if (this.isCancel(command)) {
      this.emit(VOICE_DOMAIN_EVENT_KEYS.command.cancelRecording, undefined)
      this.executeImmediateWithConfig(command, {
        reason: '取消操作',
        processingMessage: '正在取消...',
        completedMessage: '已取消',
      })
      return
    }

    if (this.isStop(command)) {
      this.emit(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, undefined)
      this.executeImmediateWithConfig(command, {
        reason: '停止操作',
        processingMessage: '正在停止...',
        completedMessage: '已停止',
      })
      return
    }

    this.emit(VOICE_DOMAIN_EVENT_KEYS.command.cancelRecording, undefined)
    this.executeImmediateWithConfig(command, {
      reason: '即时指令执行',
      processingMessage: '正在处理指令...',
      completedMessage: '指令已执行',
    })
  }

  private executeImmediateWithConfig(command: string, config: ImmediateActionConfig): void {
    this.stateModule.immediateTransition(
      VoiceState.PROCESSING,
      this.stateModule.createTransitionContext(config.reason, {
        message: config.processingMessage,
      }),
      10,
    )

    this.stopAgentIfPossible(command)

    this.stateModule.delayedTransition(
      VoiceState.COMPLETED,
      this.stateModule.createTransitionContext(config.reason, {
        transcript: '',
        message: config.completedMessage,
      }),
      200,
      10,
    )

    this.stateModule.setTranscriptAndMessage('', config.completedMessage)
    this.emit(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, undefined)

    if (this.captureModule.isHandsfreeEnabled()) {
      this.stateModule.delayedTransition(
        VoiceState.LISTENING,
        this.stateModule.createTransitionContext('免提模式自动回归', {
          volume: 0,
          transcript: '',
          message: '',
        }),
        400,
        10,
      )
    }
  }

  private stopAgentIfPossible(command: string): void {
    const sessionId = this.agentModule.getCurrentAgentSessionId()
    if (!sessionId) {
      this.logger.warn('没有sessionId，无法打断Agent')
      return
    }

    this.logger.info('调用stopAgent打断Agent', { sessionId, command })
    this.emit(VOICE_DOMAIN_EVENT_KEYS.command.stopAgent, { sessionId })
  }

  private isCancel(command: string): boolean {
    return command.includes('撤销') || command.includes('取消')
  }

  private isStop(command: string): boolean {
    return command.includes('停止') || command.includes('停下')
  }
}
