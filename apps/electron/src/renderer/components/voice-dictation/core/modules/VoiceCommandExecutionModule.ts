/**
 * 决策动作分发模块（决策事件 -> 动作事件）
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { IntelligentDecision } from '../../types/intelligence'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'

export class VoiceCommandExecutionModule {
  /** 事件退订列表 */
  private readonly unsubs: Array<() => void> = []

  constructor(
    private readonly bus: VoiceDomainEventBus,
    private readonly logger: VoiceEventLogger,
  ) {
    this.unsubs.push(
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.decision.execute, ({ decision, text }) => this.executeDecision(decision, text)),
    )
  }

  /**
   * 释放命令执行模块资源
   */
  dispose(): void {
    this.unsubs.forEach((unsub) => unsub())
  }

  /**
   * 根据决策策略分发动作事件
   */
  private executeDecision(decision: IntelligentDecision, text: string): void {
    const handlers: Record<IntelligentDecision['sendStrategy'], () => void> = {
      interrupt: () => {
        this.logger.warn('检测到即时指令，发布动作事件', { text })
        this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.action.handleImmediateInstruction, {
          command: text,
          reasoning: decision.reasoning,
        })
      },
      immediate: () => {
        this.logger.info('立即发送文本到Agent，发布动作事件', { text })
        this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText, { text, reasoning: decision.reasoning })
      },
      wait: () => {
        this.logger.info('等待发送文本，发布动作事件', { text })
        this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText, {
          text,
          reasoning: 'Agent忙碌，但仍尝试发送',
        })
      },
      continue: () => {
        this.logger.info('语音未完成，继续等待')
      },
    }

    handlers[decision.sendStrategy]()
  }
}
