/**
 * 动作处理模块（动作事件 -> 具体执行）
 */

import { emitVoiceAutoSendRequested, type VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'
import { VoiceState } from '../state/VoiceStateMachine'
import { VoiceAgentModule } from './VoiceAgentModule'
import { VoiceCaptureModule } from './VoiceCaptureModule'
import { VoiceRuntimeStateModule } from './VoiceRuntimeStateModule'

interface ImmediateActionConfig {
  reason: string
  processingMessage: string
  completedMessage: string
}

export class VoiceActionHandlerModule {
  private readonly unsubs: Array<() => void> = []

  constructor(
    private readonly bus: VoiceDomainEventBus,
    private readonly stateModule: VoiceRuntimeStateModule,
    private readonly captureModule: VoiceCaptureModule,
    private readonly agentModule: VoiceAgentModule,
    private readonly logger: VoiceEventLogger,
  ) {
    this.unsubs.push(
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText, ({ text, reasoning }) =>
        this.handleSendVoiceText(text, reasoning),
      ),
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.action.handleImmediateInstruction, ({ command, reasoning }) =>
        this.handleImmediateInstruction(command, reasoning),
      ),
    )
  }

  dispose(): void {
    this.unsubs.forEach((unsub) => unsub())
  }

  private handleSendVoiceText(text: string, reasoning: string): void {
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
      emitVoiceAutoSendRequested({ text })
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

      this.captureModule.stopRecording().catch(() => {
        this.logger.warn('停止录音会话失败或已完成')
      })
    } catch (error) {
      this.logger.error('发送语音到Agent失败', {
        error: error instanceof Error ? error.message : '未知错误',
      })
    }
  }

  private handleImmediateInstruction(command: string, reasoning: string): void {
    this.logger.warn('处理即时指令', { command, reasoning })

    if (this.isCancel(command)) {
      this.executeImmediateWithConfig(command, {
        reason: '取消操作',
        processingMessage: '正在取消...',
        completedMessage: '已取消',
      })
      return
    }

    if (this.isStop(command)) {
      this.executeImmediateWithConfig(command, {
        reason: '停止操作',
        processingMessage: '正在停止...',
        completedMessage: '已停止',
      })
      return
    }

    this.captureModule.cancelSession()
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
    this.captureModule.stopRecording().catch(() => {
      this.logger.warn('停止录音会话失败或已完成')
    })

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
    window.electronAPI.stopAgent(sessionId).catch((error) => {
      this.logger.error('打断Agent失败', {
        error: error instanceof Error ? error.message : '未知错误',
        sessionId,
      })
    })
  }

  private isCancel(command: string): boolean {
    return command.includes('撤销') || command.includes('取消')
  }

  private isStop(command: string): boolean {
    return command.includes('停止') || command.includes('停下')
  }
}
