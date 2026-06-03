/**
 * 【第 4 层 - 业务模块层】Agent 上下文模块（发布者/订阅者）
 *
 * 职责：桥接 Agent 状态到语音模块
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../../shared/bus/VoiceDomainEventBus'
import type { VoiceAgentContext } from '../../shared/types/intelligence'
import { VOICE_DOMAIN_EVENT_KEYS } from '../../shared/bus/VoiceDomainEventKeys'
import { AgentStateMonitor } from '../intelligence/AgentStateMonitor'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceAgentModule extends BaseVoiceModule {
  /** Agent 状态推导器（封装循环状态判断） */
  private readonly monitor = new AgentStateMonitor()
  /** 当前活跃的 Agent 会话 ID（用于 stopAgent） */
  private currentAgentSessionId: string | null = null

  constructor(
    bus: VoiceDomainEventBus,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.updateAgentState, (payload) => {
      this.monitor.updateAgentState(payload)
      this.logger.debug('Agent状态已更新', {
        mode: payload.mode,
        status: payload.status,
        hasError: payload.hasError,
      })
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.addRecentMessage, ({ message }) => {
      this.monitor.addRecentMessage(message)
      this.logger.debug('最近消息已添加', {
        message: `${message.substring(0, 20)}${message.length > 20 ? '...' : ''}`,
      })
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.setAgentSessionId, ({ sessionId }) => {
      this.currentAgentSessionId = sessionId
      this.logger.debug('Agent会话ID已更新', { sessionId })
    })
  }

  /**
   * 获取当前 Agent 会话 ID
   */
  getCurrentAgentSessionId(): string | null {
    return this.currentAgentSessionId
  }

  /**
   * 获取当前 Agent 上下文（供决策模块消费）
   */
  getCurrentContext(): VoiceAgentContext {
    return this.monitor.getCurrentContext()
  }

  /**
   * 释放模块资源
   */
  dispose(): void {
    this.disposeSubscriptions()
    this.monitor.dispose()
  }
}
