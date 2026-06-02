/**
 * 智能决策模块（ASR 结果 -> 决策事件）
 */

import type { ASRProvider } from '../../types/asr'
import type { UnifiedASRResult } from '../../types/intelligence'
import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'
import { UnifiedIntelligenceDetector } from '../intelligence/UnifiedIntelligenceDetector'
import { VoiceAgentModule } from './VoiceAgentModule'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceDecisionModule extends BaseVoiceModule {
  /** 智能检测器（语音完整性 + 发送策略） */
  private readonly detector = new UnifiedIntelligenceDetector()
  /** 当前 ASR 引擎类型（用于构建统一结果） */
  private currentEngine: 'doubao' | 'webspeech' = 'doubao'
  /** 最近一次已发送文本（用于去重） */
  private lastSentText = ''
  /** 最近一次发送时间戳 */
  private lastSentAt = 0

  constructor(
    bus: VoiceDomainEventBus,
    private readonly agentModule: VoiceAgentModule,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, ({ settings }) => {
      this.currentEngine = settings.engine || 'doubao'
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.transcript, ({ text, isFinal, provider }) => {
      this.handleTranscript(text, isFinal, provider)
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.session.complete, ({ text }) => {
      this.handleSessionComplete(text)
    })
  }

  /**
   * 释放决策模块资源
   */
  dispose(): void {
    this.disposeSubscriptions()
    this.detector.dispose()
  }

  /**
   * 处理转写事件并产出决策事件
   *
   * 发布：
   * - decision.feedback（用于 UI/状态反馈）
   * - decision.execute（用于命令执行）
   */
  private handleTranscript(text: string, isFinal: boolean | undefined, provider: ASRProvider): void {
    this.logger.info('收到语音转写结果', {
      text: `${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`,
      isFinal,
    })

    const asrResult = this.buildASRResult(text, isFinal, provider)
    const agentContext = this.agentModule.getCurrentContext()

    this.logger.debug('智能决策输入', {
      asrType: asrResult.asrType,
      agentLoopState: agentContext.loopState,
      canAcceptInput: agentContext.canAcceptInput,
    })

    const decision = this.detector.makeIntelligentDecision(asrResult, agentContext)
    this.logger.info('智能决策结果', {
      shouldSend: decision.shouldSend,
      sendStrategy: decision.sendStrategy,
      confidence: decision.confidence.toFixed(2),
      reasoning: decision.reasoning,
    })

    this.emit(VOICE_DOMAIN_EVENT_KEYS.decision.feedback, {
      reasoning: decision.reasoning,
      strategy: decision.sendStrategy,
    })

    if (!decision.shouldSend) return
    if (this.shouldSkipDuplicate(text)) {
      this.logger.info('跳过重复发送（转写事件）', { text: `${text.substring(0, 20)}${text.length > 20 ? '...' : ''}` })
      return
    }
    this.markSent(text)
    this.emit(VOICE_DOMAIN_EVENT_KEYS.decision.execute, { decision, text })
  }

  /**
   * 会话结束兜底决策：
   * 豆包在某些场景下不会给出 definite=true，但 stop 后文本已经稳定，此处按 final 再判一次。
   */
  private handleSessionComplete(text: string): void {
    const finalText = text.trim()
    if (!finalText) return
    if (this.shouldSkipDuplicate(finalText)) {
      this.logger.info('跳过重复发送（会话完成兜底）', {
        text: `${finalText.substring(0, 20)}${finalText.length > 20 ? '...' : ''}`,
      })
      return
    }

    const asrResult: UnifiedASRResult = {
      text: finalText,
      isFinal: true,
      confidence: 0.8,
      isComplete: true,
      asrType: this.currentEngine,
      metadata: {},
    }
    const agentContext = this.agentModule.getCurrentContext()
    const decision = this.detector.makeIntelligentDecision(asrResult, agentContext)
    if (!decision.shouldSend) return

    this.logger.info('会话完成触发兜底发送决策', {
      strategy: decision.sendStrategy,
      reasoning: decision.reasoning,
    })
    this.markSent(finalText)
    this.emit(VOICE_DOMAIN_EVENT_KEYS.decision.execute, { decision, text: finalText })
  }

  /**
   * 构建统一 ASR 结果对象
   */
  private buildASRResult(
    text: string,
    isFinal: boolean | undefined,
    provider: ASRProvider,
  ): UnifiedASRResult {
    return {
      text,
      isFinal: isFinal || false,
      confidence: 0.8,
      isComplete: false,
      asrType: this.currentEngine,
      metadata: this.extractASRMetadata(provider),
    }
  }

  /**
   * 按 Provider 能力提取元信息
   */
  private extractASRMetadata(provider: ASRProvider): Record<string, unknown> {
    const metadata: Record<string, unknown> = {}
    const typedProvider = provider as {
      getCurrentRecognitionDetails?: () => {
        definite?: boolean
        utterances?: Array<{ text: string; definite: boolean }>
      }
      getCurrentResult?: () => {
        interimText?: string
        resultIndex?: number
      }
    }

    if (typedProvider.getCurrentRecognitionDetails) {
      try {
        const details = typedProvider.getCurrentRecognitionDetails()
        metadata.definite = details.definite
        metadata.utterances = details.utterances || []
      } catch (error) {
        this.logger.warn('获取豆包ASR详细信息失败', { error })
      }
    }

    if (typedProvider.getCurrentResult) {
      try {
        const result = typedProvider.getCurrentResult()
        metadata.interimText = result.interimText
        metadata.resultIndex = result.resultIndex
      } catch (error) {
        this.logger.warn('获取WebSpeech详细信息失败', { error })
      }
    }

    return metadata
  }

  /**
   * 判定是否应跳过重复发送。
   */
  private shouldSkipDuplicate(text: string): boolean {
    const now = Date.now()
    return text === this.lastSentText && now - this.lastSentAt < 4000
  }

  /**
   * 记录最近发送文本。
   */
  private markSent(text: string): void {
    this.lastSentText = text
    this.lastSentAt = Date.now()
  }
}
