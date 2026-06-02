/**
 * 语音模块外观层（Facade）
 *
 * 说明：
 * - 该类不再承担业务编排，只负责把外部命令发布到统一事件总线
 * - 具体流程由各个发布者/订阅者模块消费事件完成
 */

import type { VoiceDictationSettings } from '@/types/settings'
import type { UIStateListener } from '../../types/panel'
import type { VoiceLogEventListener, VoiceEventLogger } from '../../ui-events'
import {
  createVoiceEventLogger,
  VoiceLogEventEmitter,
  VoiceLogEventSubscriber,
} from '../../ui-events'
import { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'
import { VoiceAgentModule } from '../modules/VoiceAgentModule'
import { VoiceCaptureModule } from '../modules/VoiceCaptureModule'
import { VoiceDecisionModule } from '../modules/VoiceDecisionModule'
import { VoiceRuntimeStateModule } from '../modules/VoiceRuntimeStateModule'
import { VoiceCommandExecutionModule } from '../modules/VoiceCommandExecutionModule'
import { VoiceActionHandlerModule } from '../modules/VoiceActionHandlerModule'
import type { AgentStateUpdatePayload } from '../bus/VoiceDomainEventBus'

function createScopedLogger(prefix: string, logger: VoiceEventLogger): VoiceEventLogger {
  return {
    debug: (message, data) => logger.debug(`[${prefix}] ${message}`, data),
    info: (message, data) => logger.info(`[${prefix}] ${message}`, data),
    warn: (message, data) => logger.warn(`[${prefix}] ${message}`, data),
    error: (message, data) => logger.error(`[${prefix}] ${message}`, data),
  }
}

export class Orchestrator {
  /** 统一日志事件发射器 */
  private readonly eventEmitter = new VoiceLogEventEmitter()
  /** 日志写入订阅器 */
  private readonly eventLogger = new VoiceLogEventSubscriber('VoiceRuntime', this.eventEmitter)
  /** 根日志器 */
  private readonly logger = createVoiceEventLogger(this.eventEmitter)
  /** 统一领域事件总线 */
  private readonly bus = new VoiceDomainEventBus()

  /** 领域模块 */
  private readonly stateModule = new VoiceRuntimeStateModule(
    this.bus,
    createScopedLogger('StateModule', this.logger),
  )

  private readonly agentModule = new VoiceAgentModule(
    this.bus,
    createScopedLogger('AgentModule', this.logger),
  )

  private readonly captureModule = new VoiceCaptureModule(
    this.bus,
    createScopedLogger('CaptureModule', this.logger),
  )

  private readonly decisionModule = new VoiceDecisionModule(
    this.bus,
    this.agentModule,
    createScopedLogger('DecisionModule', this.logger),
  )

  private readonly commandModule = new VoiceCommandExecutionModule(
    this.bus,
    createScopedLogger('CommandModule', this.logger),
  )

  private readonly actionModule = new VoiceActionHandlerModule(
    this.bus,
    this.stateModule,
    this.captureModule,
    this.agentModule,
    createScopedLogger('ActionModule', this.logger),
  )

  /**
   * 订阅 UI 状态快照
   *
   * UI 只消费投影状态，不直接操作领域模块。
   */
  onUIState(listener: UIStateListener): () => void {
    return this.stateModule.onUIState(listener)
  }

  /**
   * 订阅运行时日志事件
   */
  onEvent(listener: VoiceLogEventListener): () => void {
    return this.eventEmitter.onEvent(listener)
  }

  /**
   * 发布「切换免提」命令
   */
  async toggleHandsfree(settings: VoiceDictationSettings): Promise<void> {
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, { settings })
  }

  /**
   * 发布「停止录音」命令
   */
  async stopRecording(): Promise<void> {
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, undefined)
  }

  /**
   * 发布 Agent 状态更新命令
   */
  updateAgentState(state: AgentStateUpdatePayload): void {
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.updateAgentState, state)
  }

  /**
   * 发布最近消息追加命令
   */
  addRecentMessage(message: string): void {
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.addRecentMessage, { message })
  }

  /**
   * 发布 Agent 会话 ID 更新命令
   */
  setCurrentAgentSessionId(sessionId: string | null): void {
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.setAgentSessionId, { sessionId })
  }

  /**
   * 读取当前 Agent 会话 ID（Facade 透传）
   */
  getCurrentAgentSessionId(): string | null {
    return this.agentModule.getCurrentAgentSessionId()
  }

  /**
   * 销毁运行时
   *
   * 顺序：先发布 destroy 命令，再释放各模块和总线。
   */
  destroy(): void {
    this.logger.info('销毁语音运行时')
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.destroy, undefined)
    this.actionModule.dispose()
    this.commandModule.dispose()
    this.decisionModule.dispose()
    this.captureModule.dispose()
    this.agentModule.dispose()
    this.stateModule.dispose()
    this.bus.clear()
    this.eventLogger.dispose()
  }
}
