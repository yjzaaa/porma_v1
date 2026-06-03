/**
 * 语音模块 — 自动发送判断策略
 */

const SENTENCE_END_PUNCTUATION = /[。！？.!?，,；;：:]$/
const INCOMPLETE_ENDINGS = /(?:看看|试试|一下|这个|那个|帮我|请问|我想|能不能|可不可以|怎么样|如何|怎么|什么|为什么)$/
const MIN_AUTO_SEND_LENGTH = 4

export function shouldAutoSend(
  text: string,
  enabled: boolean = true,
  mode: 'always' | 'smart' | 'ai' = 'always',
): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (!enabled) return false

  if (mode === 'always') {
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }

  if (mode === 'smart') {
    if (trimmed.length < MIN_AUTO_SEND_LENGTH) return false
    if (SENTENCE_END_PUNCTUATION.test(trimmed)) return true
    if (INCOMPLETE_ENDINGS.test(trimmed)) return false
    if (trimmed.length > 20) return true
    return false
  }

  if (mode === 'ai') {
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }

  return false
}
