/**
 * 语音模块 — 自动发送判断
 *
 * 方案一（默认）：移除启发式判断，直接自动发送
 * 方案二（预留）：基于启发式规则判断文本完整性
 * 方案三（预留）：AI 模型判断文本完整性
 */

/** 句末标点：大概率表示完整句子 */
const SENTENCE_END_PUNCTUATION = /[。！？.!?，,；;：:]$/

/** 明确不完整的结尾词 */
const INCOMPLETE_ENDINGS = /(?:看看|试试|一下|这个|那个|帮我|请问|我想|能不能|可不可以|怎么样|如何|怎么|什么|为什么)$/

/** 低于此长度的文本不自动发送 */
const MIN_AUTO_SEND_LENGTH = 4

/**
 * 判断语音输入文本是否应该自动发送
 *
 * @param text - 语音识别的文本
 * @param enabled - 是否启用自动发送（来自设置 autoSendEnabled）
 * @param mode - 判断模式（预留扩展接口）
 *   - 'always': 方案一，直接自动发送（默认）
 *   - 'smart': 方案二，启发式规则判断
 *   - 'ai': 方案三，AI 模型判断
 * @returns 是否应该自动发送
 *
 * 方案一（当前默认）：用户主动触发语音输入 → 默认意图发送 → 直接发送
 * 方案二（预留）：可基于标点、长度、结尾词等规则判断
 * 方案三（预留）：调用 AI 模型判断文本完整性
 */
export function shouldAutoSend(
  text: string,
  enabled: boolean = true,
  mode: 'always' | 'smart' | 'ai' = 'always'
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
    // TODO: 调用 AI 模型判断
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }

  return false
}
