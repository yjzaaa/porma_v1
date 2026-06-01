/**
 * 语音模块 — 自动发送判断策略
 *
 * 三种策略（通过 mode 参数切换）：
 * - 'always'：无脑发送，只要文本长度 >= 4 即可（默认方案）
 * - 'smart'：基于启发式规则（句末标点、结尾词、长度）判断完整性
 * - 'ai'：预留的 AI 模型判断接口
 *
 * 当前使用方案 always（用户触发语音输入 → 默认意图发送 → 直接发）。
 * smart 和 ai 为未来优化预留。
 */

/** 句末标点：匹配到此标点大概率表示完整句子结束 */
const SENTENCE_END_PUNCTUATION = /[。！？.!?，,；;：:]$/

/** 明确不完整的结尾词：匹配到这些词表明句子大概率未说完 */
const INCOMPLETE_ENDINGS = /(?:看看|试试|一下|这个|那个|帮我|请问|我想|能不能|可不可以|怎么样|如何|怎么|什么|为什么)$/

/** 最小自动发送长度：低于此长度的文本不自动发送（避免单字误触发） */
const MIN_AUTO_SEND_LENGTH = 4

/**
 * 判断语音转写文本是否应该自动发送
 *
 * @param text - 语音识别的文本
 * @param enabled - 是否启用自动发送（来自设置中 autoSendEnabled）
 * @param mode - 判断模式
 *   - 'always':（默认）直接发送，超过最小长度即可
 *   - 'smart': 启发式规则判断，结合句末标点、结尾词和长度综合判定
 *   - 'ai': AI 模型判断（预留，当前回退为 always 行为）
 * @returns 是否应该自动发送到 Agent/Chat 会话
 */
export function shouldAutoSend(
  text: string,
  enabled: boolean = true,
  mode: 'always' | 'smart' | 'ai' = 'always'
): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (!enabled) return false

  // 方案一：直接发送
  if (mode === 'always') {
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }

  // 方案二：启发式规则判断
  if (mode === 'smart') {
    if (trimmed.length < MIN_AUTO_SEND_LENGTH) return false
    if (SENTENCE_END_PUNCTUATION.test(trimmed)) return true      // 以句末标点结尾 → 大概率完整
    if (INCOMPLETE_ENDINGS.test(trimmed)) return false           // 以不完整词结尾 → 大概率未说完
    if (trimmed.length > 20) return true                         // 较长文本 → 发送
    return false
  }

  // 方案三：AI 模型判断（预留）
  if (mode === 'ai') {
    // TODO: 调用 AI 模型判断文本完整性
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }

  return false
}
