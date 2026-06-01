/**
 * 统一智能检测器
 *
 * 核心职责:
 *   1. 适配豆包ASR和WebSpeech的能力差异
 *   2. 豆包ASR：充分利用definite字段 + 宽松判断
 *   3. WebSpeech：基于isFinal + 启发式增强
 *   4. 即时指令识别（通用）
 */
import type { UnifiedASRResult, AgentContext, IntelligentDecision } from '../types/intelligence'
import { AgentLoopState } from '../types/intelligence'
import { createLogger } from '../utils/logger'

export class UnifiedIntelligenceDetector {
  private logger = createLogger('智能检测器')

  /**
   * 判断语音是否完整
   */
  isSpeechComplete(result: UnifiedASRResult): boolean {
    this.logger.info('开始语音完整性判断', {
      asrType: result.asrType,
      text: result.text,
      isFinal: result.isFinal
    })

    let complete: boolean

    switch (result.asrType) {
      case 'doubao':
        complete = this.isDoubaoComplete(result)
        this.logger.debug('豆包ASR完整性判断完成', { complete, definite: result.metadata.definite })
        break

      case 'webspeech':
        complete = this.isWebSpeechComplete(result)
        this.logger.debug('WebSpeech完整性判断完成', { complete, isFinal: result.isFinal })
        break

      default:
        this.logger.warn('未知ASR类型', { asrType: result.asrType })
        complete = false
    }

    this.logger.info('语音完整性判断结果', { complete, asrType: result.asrType })
    return complete
  }

  /**
   * 豆包ASR完整性判断（宽松策略）
   *
   * 问题：原有逻辑过于严格，导致一直卡在"语音未完成"状态
   * 解决：增加多种完整性判断条件
   */
  private isDoubaoComplete(result: UnifiedASRResult): boolean {
    // 1. 检查豆包ASR的 definite 字段
    const definiteCount = result.metadata.utterances?.filter(
      u => u.definite === true
    ).length || 0

    // 2. 检查 isFinal 状态
    const isFinalComplete = result.isFinal === true

    // 3. 启发式判断：如果有一定长度的文本，也认为可能完整
    const textLength = result.text.trim().length
    const hasMinimumLength = textLength >= 3 // 至少3个字符

    // 4. 检查是否有结束标点
    const hasEndingPunctuation = /[。！？.!?]$/.test(result.text.trim())

    // 5. 检查是否有明显的停顿标志（逗号、分号等）
    const hasPauseMarker = /[，,；;、]$/.test(result.text.trim())

    // 综合判断：宽松的条件避免卡在"未完成"状态
    // 优先级：isFinal > definite > 长句子+标点 > 有标点
    const complete = isFinalComplete ||
                      definiteCount > 0 ||
                      (hasMinimumLength && hasEndingPunctuation) ||
                      (textLength >= 5 && hasPauseMarker)

    this.logger.debug('豆包ASR完整性判断', {
      definiteCount,
      isFinal: result.isFinal,
      textLength,
      hasMinimumLength,
      hasEndingPunctuation,
      hasPauseMarker,
      complete
    })

    return complete
  }

  /**
   * WebSpeech完整性判断（增强能力）
   */
  private isWebSpeechComplete(result: UnifiedASRResult): boolean {
    // 1. 基础判断：使用 isFinal
    if (result.isFinal) {
      // 2. 启发式增强：检测完整句子特征
      const sentenceComplete = this.checkSentenceCompleteness(result.text)
      this.logger.debug('WebSpeech启发式判断', {
        text: result.text,
        sentenceComplete
      })
      return sentenceComplete
    }

    this.logger.debug('WebSpeech未达到isFinal条件')
    return false
  }

  /**
   * 检查句子完整性（启发式规则）
   */
  private checkSentenceCompleteness(text: string): boolean {
    const trimmed = text.trim()

    // 句末标点检测
    if (/[。！？.!?]$/.test(trimmed)) {
      this.logger.debug('检测到句末标点', { text: trimmed })
      return true
    }

    // 长度检测
    if (trimmed.length > 20 && !/[,，]$/.test(trimmed)) {
      this.logger.debug('检测到长句子', { length: trimmed.length })
      return true
    }

    // 问句检测
    if (/[？?]$/.test(trimmed)) {
      this.logger.debug('检测到问句', { text: trimmed })
      return true
    }

    // 感叹号检测
    if (/[！!]$/.test(trimmed)) {
      this.logger.debug('检测到感叹句', { text: trimmed })
      return true
    }

    this.logger.debug('句子完整性检查未通过', { text: trimmed })
    return false
  }

  /**
   * 即时指令检测（通用）
   */
  isImmediateCommand(text: string): boolean {
    const immediateCommands = ['撤销', '停止', '取消', '重新开始', '不要这样', '停下', '等等', '打断', '中断', '暂停']
    const isCommand = immediateCommands.some(cmd => text.includes(cmd))

    if (isCommand) {
      this.logger.info('检测到即时指令', { text, command: text })
    }

    return isCommand
  }

  /**
   * 智能决策：是否发送以及发送策略
   */
  makeIntelligentDecision(
    asrResult: UnifiedASRResult,
    agentContext: AgentContext
  ): IntelligentDecision {

    this.logger.info('开始智能决策', {
      text: asrResult.text,
      confidence: asrResult.confidence,
      agentLoopState: agentContext.loopState
    })

    // 1. 检查即时指令
    if (this.isImmediateCommand(asrResult.text)) {
      this.logger.warn('检测到即时指令，优先处理', { text: asrResult.text })
      return {
        shouldSend: true,
        sendStrategy: 'interrupt',
        confidence: 0.9,
        reasoning: '检测到即时指令'
      }
    }

    // 2. 检查语音完整性
    const isComplete = this.isSpeechComplete(asrResult)

    if (!isComplete) {
      this.logger.info('语音未完成，继续等待')
      return {
        shouldSend: false,
        sendStrategy: 'continue',
        confidence: asrResult.confidence,
        reasoning: '语音未完成'
      }
    }

    // 3. 结合Agent状态决策
    this.logger.debug('Agent状态分析', {
      loopState: agentContext.loopState,
      canAcceptInput: agentContext.canAcceptInput
    })

    if (agentContext.loopState === AgentLoopState.PRE_USER_INPUT) {
      this.logger.info('Agent空闲，立即发送')
      return {
        shouldSend: true,
        sendStrategy: 'immediate',
        confidence: asrResult.confidence,
        reasoning: '语音完整且Agent空闲'
      }
    }

    if (agentContext.loopState === AgentLoopState.ERROR_STATE) {
      this.logger.info('Agent错误状态，需要用户输入')
      return {
        shouldSend: true,
        sendStrategy: 'immediate',
        confidence: asrResult.confidence,
        reasoning: 'Agent错误状态，需要用户输入'
      }
    }

    // Agent忙碌，但有时效指令需要打断
    const criticalTools = ['file_write', 'database_write', 'system_modify']
    const isCriticalTool = agentContext.activeToolCalls.some(
      tool => criticalTools.includes(tool)
    )

    this.logger.debug('工具执行状态分析', {
      activeTools: agentContext.activeToolCalls,
      isCriticalTool
    })

    if (!isCriticalTool && this.isImportantMessage(asrResult.text)) {
      this.logger.warn('重要消息，准备打断Agent处理')
      return {
        shouldSend: true,
        sendStrategy: 'interrupt',
        confidence: asrResult.confidence * 0.8,
        reasoning: '重要消息，打断处理'
      }
    }

    // 默认：等待Agent空闲
    this.logger.info('Agent忙碌，排队等待')
    return {
      shouldSend: true,
      sendStrategy: 'wait',
      confidence: asrResult.confidence,
      reasoning: 'Agent忙碌，排队等待'
    }
  }

  /**
   * 判断是否为重要消息
   */
  private isImportantMessage(text: string): boolean {
    // 较长的消息可能更重要
    if (text.length > 15) {
      this.logger.debug('长消息判定为重要', { length: text.length })
      return true
    }

    // 包含关键词的消息
    const keywords = ['重要', '紧急', '错误', '失败', '问题']
    const hasKeyword = keywords.some(keyword => text.includes(keyword))

    if (hasKeyword) {
      this.logger.debug('关键词检测，判定为重要消息', { text, keywords })
    }

    return hasKeyword
  }
}