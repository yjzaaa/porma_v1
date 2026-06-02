/**
 * 决策动作分发模块（决策事件 -> 动作事件）
 *
 * 职责：根据决策的发送策略，分发到不同的动作处理器
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { IntelligentDecision } from '../../types/intelligence'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceCommandExecutionModule extends BaseVoiceModule {
  constructor(
    bus: VoiceDomainEventBus,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)

    // === 订阅决策执行事件 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.decision.execute, ({ decision, text }) => {
      this.executeDecision(decision, text)
    })
  }

  /**
   * 释放命令执行模块资源
   */
  dispose(): void {
    this.disposeSubscriptions()
  }

  /**
   * 根据决策策略分发动作事件
   *
   * 流程：
   *   🎯 接收决策结果
   *   🔄 根据策略分发
   *   🚀 触发对应动作
   */
  private executeDecision(decision: IntelligentDecision, text: string): void {
    // === 🎯 第1步：接收决策结果 ===
    this.logger.info('🎯 收到决策执行', {
      sendStrategy: decision.sendStrategy,
      text: this.formatText(text),
      reasoning: decision.reasoning,
    })

    // === 🔄 第2步：根据发送策略分发 ===
    const handlers: Record<IntelligentDecision['sendStrategy'], () => void> = {
      interrupt: () => {
        // === 🚨 即时指令处理 ===
        this.logger.warn('🚨 检测到即时指令，触发即时处理', {
          command: this.formatText(text),
        })

        this.emit(VOICE_DOMAIN_EVENT_KEYS.action.handleImmediateInstruction, {
          command: text,
          reasoning: decision.reasoning,
        })
      },

      immediate: () => {
        // === 🚀 立即发送 ===
        this.logger.info('🚀 立即发送文本到Agent', {
          text: this.formatText(text),
        })

        this.emit(VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText, {
          text,
          reasoning: decision.reasoning,
        })
      },

      wait: () => {
        // === ⏳ 等待发送 ===
        this.logger.info('⏳ Agent忙碌，但仍尝试发送', {
          text: this.formatText(text),
        })

        this.emit(VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText, {
          text,
          reasoning: 'Agent忙碌，但仍尝试发送',
        })
      },

      continue: () => {
        // === ⏸️ 继续等待 ===
        this.logger.info('⏸️ 语音未完成，继续等待')
      },
    }

    // === 🚀 第3步：执行对应策略 ===
    handlers[decision.sendStrategy]()
  }

  /**
   * 格式化文本用于日志显示
   */
  private formatText(text: string): string {
    const maxLength = 20
    return text.length > maxLength
      ? `${text.substring(0, maxLength)}...`
      : text
  }
}
