/**
 * 语音文本值对象
 *
 * 统一承载文本规范化结果，供自动发送和智能决策复用。
 */

const SENTENCE_END_PUNCTUATION = /[。！？.!?]$/
const PAUSE_END_PUNCTUATION = /[，,；;、：:]$/
const INCOMPLETE_ENDINGS = /(?:看看|试试|一下|这个|那个|帮我|请问|我想|能不能|可不可以|怎么样|如何|怎么|什么|为什么)$/

/** 语音文本快照 */
export interface VoiceTextSnapshot {
  /** 原始文本 */
  readonly text: string
  /** 去掉前后空白后的文本 */
  readonly trimmedText: string
  /** 文本长度 */
  readonly length: number
  /** 是否为空文本 */
  readonly isBlank: boolean
  /** 是否以句末标点结尾 */
  readonly hasSentenceEndingPunctuation: boolean
  /** 是否以停顿标点结尾 */
  readonly hasPauseEndingPunctuation: boolean
  /** 是否以未完成表达结尾 */
  readonly endsWithIncompleteEnding: boolean
}

/**
 * 创建语音文本快照
 *
 * @param text 原始文本
 * @returns 规范化后的文本快照
 */
export function createVoiceTextSnapshot(text: string): VoiceTextSnapshot {
  const trimmedText = text.trim()

  return {
    text,
    trimmedText,
    length: trimmedText.length,
    isBlank: trimmedText.length === 0,
    hasSentenceEndingPunctuation: SENTENCE_END_PUNCTUATION.test(trimmedText),
    hasPauseEndingPunctuation: PAUSE_END_PUNCTUATION.test(trimmedText),
    endsWithIncompleteEnding: INCOMPLETE_ENDINGS.test(trimmedText),
  }
}
