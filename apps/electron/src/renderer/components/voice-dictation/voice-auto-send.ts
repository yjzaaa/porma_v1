/**
 * 语音输入自动发送 — 本地快速路径判断
 *
 * 基于启发式规则判断语音识别的文本是否为"完整可执行指令"，
 * 避免每次都调用 AI 模型，降低延迟和成本。
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
 * 快速路径（纯本地，零延迟）：
 * 1. 句末标点结尾 → 完整指令，自动发送
 * 2. 文本过短（< 4 字符） → 不发送
 * 3. 以模糊词结尾（"看看"、"试试"） → 不发送，等待用户追加
 * 4. 其他情况 → 保守不发送
 *
 * 命中率预计 > 70%，后续可接入 AI 判断处理边缘 case。
 */
export function shouldAutoSend(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // 文本过短，不自动发送
  if (trimmed.length < MIN_AUTO_SEND_LENGTH) return false

  // 句末标点结尾 → 完整指令
  if (SENTENCE_END_PUNCTUATION.test(trimmed)) return true

  // 以模糊/试探性词结尾 → 不完整
  if (INCOMPLETE_ENDINGS.test(trimmed)) return false

  // 文本较长（>20 字符）且不含模糊结尾 → 大概率完整
  if (trimmed.length > 20) return true

  // 其他情况保守不发送
  return false
}
