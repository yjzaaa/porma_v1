/**
 * 语音决策领域服务
 *
 * 负责把“语音是否完整”和“当前是否适合发送”收敛为统一领域规则。
 */

import type { IntelligentDecision, UnifiedASRResult, VoiceAgentContext } from '../../shared/types/intelligence'
import { AgentLoopState } from '../../shared/types/intelligence'
import { createVoiceTextSnapshot, type VoiceTextSnapshot } from '../../shared/utils/voice-text'

/**
 * 语音发送决策策略
 */
export class VoiceSpeechDecisionPolicy {
  /**
   * 判断语音是否完整
   *
   * @param result 统一语音识别结果
   * @returns 是否可视为完整输入
   */
  isSpeechComplete(result: UnifiedASRResult): boolean {
    if (result.isComplete === true) {
      return true
    }

    const snapshot = createVoiceTextSnapshot(result.text)

    switch (result.asrType) {
      case 'doubao':
        return this.isDoubaoComplete(result, snapshot)

      case 'webspeech':
        return this.isWebSpeechComplete(result, snapshot)

      default:
        return false
    }
  }

  /**
   * 根据语音结果和 Agent 上下文生成决策
   *
   * @param asrResult 统一语音识别结果
   * @param agentContext Agent 上下文
   * @returns 发送决策
   */
  makeDecision(
    asrResult: UnifiedASRResult,
    agentContext: VoiceAgentContext,
  ): IntelligentDecision {
    if (this.isImmediateCommand(asrResult.text)) {
      return {
        shouldSend: true,
        sendStrategy: 'interrupt',
        confidence: 0.9,
        reasoning: '检测到即时指令',
      }
    }

    if (!this.isSpeechComplete(asrResult)) {
      return {
        shouldSend: false,
        sendStrategy: 'continue',
        confidence: asrResult.confidence,
        reasoning: '语音未完成',
      }
    }

    if (agentContext.loopState === AgentLoopState.PRE_USER_INPUT) {
      return {
        shouldSend: true,
        sendStrategy: 'immediate',
        confidence: asrResult.confidence,
        reasoning: '语音完整且Agent空闲',
      }
    }

    if (agentContext.loopState === AgentLoopState.ERROR_STATE) {
      return {
        shouldSend: true,
        sendStrategy: 'immediate',
        confidence: asrResult.confidence,
        reasoning: 'Agent错误状态，需要用户输入',
      }
    }

    const criticalTools = ['file_write', 'database_write', 'system_modify']
    const isCriticalTool = agentContext.activeToolCalls.some(tool => criticalTools.includes(tool))

    if (!isCriticalTool && this.isImportantMessage(asrResult.text)) {
      return {
        shouldSend: true,
        sendStrategy: 'interrupt',
        confidence: asrResult.confidence * 0.8,
        reasoning: '重要消息，打断处理',
      }
    }

    return {
      shouldSend: true,
      sendStrategy: 'wait',
      confidence: asrResult.confidence,
      reasoning: 'Agent忙碌，排队等待',
    }
  }

  /**
   * 豆包 ASR 完整性判断
   */
  private isDoubaoComplete(
    result: UnifiedASRResult,
    snapshot: VoiceTextSnapshot,
  ): boolean {
    const definiteCount = result.metadata.utterances?.filter(u => u.definite === true).length || 0
    const isFinalComplete = result.isFinal === true
    const hasMinimumLength = snapshot.length >= 3

    return (
      isFinalComplete ||
      definiteCount > 0 ||
      (hasMinimumLength && snapshot.hasSentenceEndingPunctuation) ||
      (snapshot.length >= 5 && snapshot.hasPauseEndingPunctuation)
    )
  }

  /**
   * WebSpeech 完整性判断
   */
  private isWebSpeechComplete(
    result: UnifiedASRResult,
    snapshot: VoiceTextSnapshot,
  ): boolean {
    if (!result.isFinal) {
      return false
    }

    if (snapshot.hasSentenceEndingPunctuation) {
      return true
    }

    if (snapshot.length > 20 && !snapshot.hasPauseEndingPunctuation) {
      return true
    }

    return /[？?]$/.test(snapshot.trimmedText) || /[！!]$/.test(snapshot.trimmedText)
  }

  /**
   * 即时指令判断
   */
  private isImmediateCommand(text: string): boolean {
    const immediateCommands = ['撤销', '停止', '取消', '重新开始', '不要这样', '停下', '等等', '打断', '中断', '暂停']
    return immediateCommands.some(cmd => text.includes(cmd))
  }

  /**
   * 重要消息判断
   */
  private isImportantMessage(text: string): boolean {
    if (text.length > 15) {
      return true
    }

    const keywords = ['重要', '紧急', '错误', '失败', '问题']
    return keywords.some(keyword => text.includes(keyword))
  }
}
