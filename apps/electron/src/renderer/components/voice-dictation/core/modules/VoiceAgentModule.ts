/**
 * Agent 上下文模块（发布者/订阅者）
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'
import { AgentStateMonitor } from '../intelligence/AgentStateMonitor'

export class VoiceAgentModule {
  /** Agent 状态推导器（封装循环状态判断） */
  private readonly monitor = new AgentStateMonitor()
  /** 事件退订列表 */
  private readonly unsubs: Array<() => void> = []
  /** 当前活跃的 Agent 会话 ID（用于 stopAgent） */
  private currentAgentSessionId: string | null = null

  constructor(
    private readonly bus: VoiceDomainEventBus,
    private readonly logger: VoiceEventLogger,
  ) {
    this.unsubs.push(
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.command.updateAgentState, (payload) => {
        this.monitor.updateAgentState(payload)
        this.logger.debug('Agent状态已更新', {
          mode: payload.mode,
          status: payload.status,
          hasError: payload.hasError,
        })
      }),
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.command.addRecentMessage, ({ message }) => {
        this.monitor.addRecentMessage(message)
        this.logger.debug('最近消息已添加', {
          message: `${message.substring(0, 20)}${message.length > 20 ? '...' : ''}`,
        })
      }),
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.command.setAgentSessionId, ({ sessionId }) => {
        this.currentAgentSessionId = sessionId
        this.logger.debug('Agent会话ID已更新', { sessionId })
      }),
    )
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
  getCurrentContext() {
    return this.monitor.getCurrentContext()
  }

  /**
   * 释放模块资源
   */
  dispose(): void {
    this.unsubs.forEach((unsub) => unsub())
    this.monitor.dispose()
  }
}
