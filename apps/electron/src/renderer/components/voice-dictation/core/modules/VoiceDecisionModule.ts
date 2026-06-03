/**
 * 【第 4 层 - 业务模块层】智能决策模块（ASR 结果 -> 决策事件）
 *
 * 职责：将 ASR 转写结果转换为发送决策
 */

import type { ASRProvider } from '../../shared/types/asr'
import type { ASRProviderType } from '../../shared/types/asr'
import type { UnifiedASRResult } from '../../shared/types/intelligence'
import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../../shared/bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../../shared/bus/VoiceDomainEventKeys'
import { VoiceASRResultFactory } from '../intelligence/VoiceASRResultFactory'
import { VoiceSendDeduplicator } from '../intelligence/VoiceSendDeduplicator'
import { VoiceSpeechDecisionPolicy } from '../intelligence/VoiceSpeechDecisionPolicy'
import { VoiceAgentModule } from './VoiceAgentModule'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceDecisionModule extends BaseVoiceModule {
  /** ASR 结果工厂 */
  private readonly asrResultFactory = new VoiceASRResultFactory()
  /** 语音决策领域服务 */
  private readonly policy = new VoiceSpeechDecisionPolicy()
  /** 发送去重器 */
  private readonly deduplicator = new VoiceSendDeduplicator()
  /** 当前 ASR 引擎类型（用于构建统一结果） */
  private currentEngine: ASRProviderType = 'doubao'

  constructor(
    bus: VoiceDomainEventBus,
    private readonly agentModule: VoiceAgentModule,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)

    // === 订阅转写事件 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.transcript, ({ text, isFinal, provider }) => {
      this.handleTranscript(text, isFinal, provider)
    })

    // === 订阅会话完成事件 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.complete, ({ text }) => {
      this.handleSessionComplete(text)
    })

    // === 订阅切换命令 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, ({ settings }) => {
      this.currentEngine = settings.engine || 'doubao'
    })
  }

  /**
   * 释放决策模块资源
   */
  dispose(): void {
    this.disposeSubscriptions()
  }

  /**
   * 处理转写事件并产出决策事件
   *
   * 流程：
   *   📥 接收转写结果
   *   🔧 构建ASR结果
   *   🔍 获取Agent状态
   *   🧠 智能决策
   *   📊 发布决策反馈
   *   🚀 发布执行命令（如果决定发送）
   */
  private handleTranscript(text: string, isFinal: boolean | undefined, provider: ASRProvider): void {
    // === 📥 第1步：接收转写结果 ===
    this.logger.info('🧠 DecisionModule.handleTranscript 被调用', {
      text: this.formatText(text),
      isFinal,
    })
    this.logger.info('📥 收到转写结果', {
      text: this.formatText(text),
      isFinal,
    })

    // === 🔧 第2步：构建ASR结果 ===
    const asrResult = this.asrResultFactory.create(text, isFinal, this.currentEngine, provider)

    // === 🔍 第3步：获取Agent状态 ===
    const agentContext = this.agentModule.getCurrentContext()

    this.logger.debug('🧠 决策输入', {
      asrType: asrResult.asrType,
      agentLoopState: agentContext.loopState,
      canAcceptInput: agentContext.canAcceptInput,
    })

    // === 🧠 第4步：智能决策 ===
    const decision = this.policy.makeDecision(asrResult, agentContext)

    this.logger.info('🎯 决策结果', {
      shouldSend: decision.shouldSend,
      sendStrategy: decision.sendStrategy,
      confidence: decision.confidence.toFixed(2),
      reasoning: decision.reasoning,
    })

    // === 📊 第5步：发布决策反馈 ===
    this.emit(VOICE_DOMAIN_EVENT_KEYS.decision.feedback, {
      reasoning: decision.reasoning,
      strategy: decision.sendStrategy,
    })

    // === 🚀 第6步：如果决定发送，发布执行命令 ===
    if (decision.shouldSend) {
      // 检查去重
      if (this.deduplicator.shouldSkip(text)) {
        this.logger.info('⏭️ 跳过重复发送', {
          text: this.formatText(text),
        })
        return
      }

      this.deduplicator.record(text)

      // 发布执行命令
      this.logger.info('🧠 DecisionModule 发出决策执行事件', {
        sendStrategy: decision.sendStrategy,
        text: this.formatText(text),
      })
      this.emit(VOICE_DOMAIN_EVENT_KEYS.decision.execute, { decision, text })
    }
  }

  /**
   * 会话结束兜底决策
   *
   * 作用：豆包在某些场景下不会给出 definite=true，但 stop 后文本已经稳定
   *       此处按 final 再判一次，确保不会丢失用户输入
   */
  private handleSessionComplete(text: string): void {
    const finalText = text.trim()
    if (!finalText) return

    if (this.deduplicator.shouldSkip(finalText)) {
      this.logger.info('⏭️ 跳过重复发送（会话结束兜底）', {
        text: this.formatText(finalText),
      })
      return
    }

    this.logger.info('🔄 会话结束，触发兜底决策')

    const asrResult: UnifiedASRResult = this.asrResultFactory.create(finalText, true, this.currentEngine)
    asrResult.isComplete = true

    const agentContext = this.agentModule.getCurrentContext()
    const decision = this.policy.makeDecision(asrResult, agentContext)

    if (decision.shouldSend) {
      this.logger.info('✅ 兜底决策通过', {
        strategy: decision.sendStrategy,
        reasoning: decision.reasoning,
      })

      this.deduplicator.record(finalText)

      this.emit(VOICE_DOMAIN_EVENT_KEYS.decision.execute, {
        decision,
        text: finalText,
      })
    }
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
