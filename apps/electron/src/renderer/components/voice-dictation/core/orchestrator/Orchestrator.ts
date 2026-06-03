/**
 * 【第 5 层 - 编排层】语音模块外观层（Facade）
 *
 * 说明：
 * - 该类不再承担业务编排，只负责把外部命令发布到统一事件总线
 * - 具体流程由各个发布者/订阅者模块消费事件完成
 *
 * 职责：
 * - 创建所有业务模块实例
 * - 发布命令到领域事件总线
 * - 管理模块生命周期
 * - 接收外部注入的 transportBus（ASR 对外交交互总线）
 */

import type { VoiceDictationSettings } from '@/types/settings'
import type { UIStateListener } from '../../shared/types/panel'
import type { VoiceLogEventListener, VoiceEventLogger } from '../../ui-events'
import type { VoiceAsrTransportBus } from '../../shared/bus/VoiceAsrTransportBus'
import type { VoiceDictationIpcBridge } from '../../shared/types/voice-dictation-ipc'
import {
  createVoiceEventLogger,
  emitVoiceAutoSendRequested,
  VoiceLogEventEmitter,
  VoiceLogEventSubscriber,
} from '../../ui-events'
import { VoiceDomainEventBus } from '../../shared/bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../../shared/bus/VoiceDomainEventKeys'
import { VoiceAgentModule } from '../modules/VoiceAgentModule'
import { VoiceCaptureModule } from '../modules/VoiceCaptureModule'
import { VoiceDecisionModule } from '../modules/VoiceDecisionModule'
import { VoiceRuntimeStateModule } from '../modules/VoiceRuntimeStateModule'
import { VoiceCommandExecutionModule } from '../modules/VoiceCommandExecutionModule'
import { VoiceActionHandlerModule } from '../modules/VoiceActionHandlerModule'
import type { AgentStateUpdatePayload } from '../../shared/bus/VoiceDomainEventBus'

function createScopedLogger(prefix: string, logger: VoiceEventLogger): VoiceEventLogger {
  return {
    debug: (message, data) => logger.debug(`[${prefix}] ${message}`, data),
    info: (message, data) => logger.info(`[${prefix}] ${message}`, data),
    warn: (message, data) => logger.warn(`[${prefix}] ${message}`, data),
    error: (message, data) => logger.error(`[${prefix}] ${message}`, data),
  }
}

export class Orchestrator {
  /** 桥接订阅（领域总线 -> UI 事件） */
  private readonly bridgeUnsubs: Array<() => void> = []
  /** 统一日志事件发射器 */
  private readonly eventEmitter = new VoiceLogEventEmitter()
  /** 日志写入订阅器 */
  private readonly eventLogger: VoiceLogEventSubscriber
  /** 根日志器 */
  private readonly logger = createVoiceEventLogger(this.eventEmitter)
  /** 统一领域事件总线 */
  private readonly bus = new VoiceDomainEventBus()

  /** 领域模块（在构造函数中初始化） */
  private readonly stateModule: VoiceRuntimeStateModule
  private readonly agentModule: VoiceAgentModule
  private readonly captureModule: VoiceCaptureModule
  private readonly decisionModule: VoiceDecisionModule
  private readonly commandModule: VoiceCommandExecutionModule
  private readonly actionModule: VoiceActionHandlerModule

  constructor(
    /** ASR 对外交互总线（由外部 Hook 注入） */
    private readonly transportBus: VoiceAsrTransportBus,
    /** hook 层实现的语音 IPC 桥接 */
    private readonly ipcBridge: VoiceDictationIpcBridge,
  ) {
    this.eventLogger = new VoiceLogEventSubscriber(
      'VoiceRuntime',
      this.eventEmitter,
      { writeLogFile: this.ipcBridge.writeVoiceDictationLog },
    )

    // 按依赖顺序初始化模块
    this.stateModule = new VoiceRuntimeStateModule(
      this.bus,
      createScopedLogger('📊 StateModule', this.logger),
    )

    this.agentModule = new VoiceAgentModule(
      this.bus,
      createScopedLogger('🤖 AgentModule', this.logger),
    )

    this.captureModule = new VoiceCaptureModule(
      this.bus,
      createScopedLogger('🎤 CaptureModule', this.logger),
      this.transportBus,
      this.ipcBridge.commitVoiceDictation,
    )

    this.decisionModule = new VoiceDecisionModule(
      this.bus,
      this.agentModule,
      createScopedLogger('🧠 DecisionModule', this.logger),
    )

    this.commandModule = new VoiceCommandExecutionModule(
      this.bus,
      createScopedLogger('⚡ CommandModule', this.logger),
    )

    this.actionModule = new VoiceActionHandlerModule(
      this.bus,
      this.stateModule,
      this.captureModule,
      this.agentModule,
      createScopedLogger('🎯 ActionModule', this.logger),
      this.ipcBridge.stopAgent,
    )

    this.logger.info('🏗️ 初始化语音运行时')

    // === 🌉 桥接UI事件 ===
    this.bridgeUnsubs.push(
      this.bus.on(VOICE_DOMAIN_EVENT_KEYS.ui.autoSendRequested, ({ text }) => {
        this.logger.info('📤 收到自动发送请求', { text: this.formatText(text) })
        emitVoiceAutoSendRequested({ text })
      }),
    )

    this.logger.info('✅ 语音运行时初始化完成')
  }

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
   * 🎤 发布「切换免提」命令
   *
   * 用户点击免提按钮 → 触发音频采集启动
   */
  async toggleHandsfree(settings: VoiceDictationSettings): Promise<void> {
    this.logger.info('🎤 发布切换免提命令', {
      engine: settings.engine,
      enabled: settings.enabled,
    })

    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, { settings })
  }

  /**
   * ⏹️ 发布「停止录音」命令
   *
   * 用户点击停止按钮 → 立即停止当前录音
   */
  async stopRecording(): Promise<void> {
    this.logger.info('⏹️ 发布停止录音命令')

    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, undefined)
  }

  /**
   * 🤖 发布 Agent 状态更新命令
   *
   * Agent 状态变更 → 更新决策模块的上下文
   */
  updateAgentState(state: AgentStateUpdatePayload): void {
    this.logger.debug('🤖 更新Agent状态', {
      mode: state.mode,
      status: state.status,
      running: state.streamingState?.running,
    })

    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.updateAgentState, state)
  }

  /**
   * 💬 发布最近消息追加命令
   *
   * Agent 收到新消息 → 更新去重判断的上下文
   */
  addRecentMessage(message: string): void {
    this.logger.debug('💬 追加最近消息', {
      message: this.formatText(message),
    })

    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.addRecentMessage, { message })
  }

  /**
   * 🆔 发布 Agent 会话 ID 更新命令
   *
   * Agent 会话切换 → 重置上下文关联
   */
  setCurrentAgentSessionId(sessionId: string | null): void {
    this.logger.debug('🆔 更新Agent会话ID', { sessionId })

    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.setAgentSessionId, { sessionId })
  }

  /**
   * 读取当前 Agent 会话 ID（Facade 透传）
   */
  getCurrentAgentSessionId(): string | null {
    return this.agentModule.getCurrentAgentSessionId()
  }

  /**
   * 💥 销毁运行时
   *
   * 流程：
   *   📢 发布销毁命令
   *   🎯 释放各层模块
   *   🧹 清理事件总线
   *   ✅ 完成清理
   */
  destroy(): void {
    this.logger.info('💥 开始销毁语音运行时')

    // === 📢 第1步：发布销毁命令 ===
    this.bus.emit(VOICE_DOMAIN_EVENT_KEYS.command.destroy, undefined)

    // === 🎯 第2步：按逆序释放各层模块 ===
    this.logger.info('🎯 释放动作处理模块')
    this.actionModule.dispose()

    this.logger.info('🎯 释放命令执行模块')
    this.commandModule.dispose()

    this.logger.info('🎯 释放决策模块')
    this.decisionModule.dispose()

    this.logger.info('🎯 释放采集模块')
    this.captureModule.dispose()

    this.logger.info('🎯 释放Agent模块')
    this.agentModule.dispose()

    this.logger.info('🎯 释放状态模块')
    this.stateModule.dispose()

    // === 🧹 第3步：清理桥接订阅 ===
    this.bridgeUnsubs.forEach((unsub) => unsub())

    // === 🧹 第4步：清理事件总线 ===
    this.bus.clear()

    // === 🧹 第5步：清理日志系统 ===
    this.eventLogger.dispose()

    this.logger.info('✅ 语音运行时销毁完成')
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
