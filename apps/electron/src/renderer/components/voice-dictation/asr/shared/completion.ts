/**
 * ASR 文本完整性规则
 *
 * 把 WebSpeech / 决策层共享的句子完整性启发式收敛到同一处。
 */

import type { UnifiedASRResult } from '../../shared/types/intelligence'

const SENTENCE_ENDING_PUNCTUATION = /[。！？.!?]$/
const PAUSE_ENDING_PUNCTUATION = /[，,；;、：:]$/

/**
 * 判断一段文本是否更像完整句子
 */
export function isLikelyCompleteText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (SENTENCE_ENDING_PUNCTUATION.test(trimmed)) {
    return true
  }

  if (trimmed.length > 20 && !/[，,]$/.test(trimmed)) {
    return true
  }

  if (/[？?]$/.test(trimmed)) {
    return true
  }

  if (/[！!]$/.test(trimmed)) {
    return true
  }

  return false
}

/**
 * 判断是否适合把 WebSpeech 临时文本提升为最终结果
 */
export function shouldPromoteWebSpeechInterimToFinal(text: string): boolean {
  return isLikelyCompleteText(text)
}

/**
 * 判断统一 ASR 结果是否完整
 */
export function isCompleteAsrResult(result: UnifiedASRResult): boolean {
  if (result.isComplete === true) {
    return true
  }

  const trimmed = result.text.trim()
  if (!trimmed) {
    return false
  }

  if (result.asrType === 'webspeech') {
    return result.isFinal && isLikelyCompleteText(result.text)
  }

  const definiteCount = result.metadata.utterances?.filter((utterance) => utterance.definite === true).length ?? 0
  if (result.isFinal || definiteCount > 0) {
    return true
  }

  if (trimmed.length >= 3 && SENTENCE_ENDING_PUNCTUATION.test(trimmed)) {
    return true
  }

  return trimmed.length >= 5 && PAUSE_ENDING_PUNCTUATION.test(trimmed)
}
