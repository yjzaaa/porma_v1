/**
 * Chat Token 估算模块
 *
 * 基于字符级启发式估算消息列表的 token 消耗量，
 * 用于在发送前检测是否接近模型上下文窗口限制。
 *
 * 算法复用自 agent-tool-token-estimator.ts。
 */

import type { ChatMessage } from '@proma/shared'

// ===== 字符分类 =====

/**
 * 判断 Unicode 码点是否为 CJK 字符
 */
function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x4E00 && cp <= 0x9FFF) ||
    (cp >= 0x3000 && cp <= 0x303F) ||
    (cp >= 0xFF00 && cp <= 0xFFEF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0x3040 && cp <= 0x30FF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x20000 && cp <= 0x2A6DF)
  )
}

/**
 * 估算单段文本的近似 token 数
 *
 * CJK ≈ 1.5 tokens/char，ASCII ≈ 0.25 tokens/char，其他 ≈ 0.75 tokens/char。
 * 偏保守：宁可高估触发裁剪，也不低估导致 API 报错。
 */
export function estimateTokenCount(text: string): number {
  let cjkCount = 0
  let asciiCount = 0
  let otherCount = 0

  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if (isCjkCodePoint(cp)) {
      cjkCount++
    } else if (cp < 128) {
      asciiCount++
    } else {
      otherCount++
    }
  }

  return Math.ceil(cjkCount * 1.5 + asciiCount * 0.25 + otherCount * 0.75)
}

/** 每条消息的格式化开销（role 标记、分隔符等） */
const MESSAGE_OVERHEAD_TOKENS = 4

/** 工具定义的基础开销估算 */
const TOOLS_BASE_OVERHEAD_TOKENS = 200

/**
 * 估算消息列表的总 token 消耗量
 *
 * 包括：system message + 历史消息 + 用户消息 + 格式化开销。
 * 用于在发送 API 请求前判断是否需要裁剪。
 *
 * @param messages 历史消息列表（经过 filterHistory 后的）
 * @param systemMessage 系统提示词
 * @param userMessage 当前用户消息文本
 * @param toolCount 启用的工具数量（0 表示无工具）
 * @returns 估算的总 token 数
 */
export function estimateMessagesTokens(
  messages: ChatMessage[],
  systemMessage?: string,
  userMessage?: string,
  toolCount: number = 0,
): number {
  let total = 0

  // system message
  if (systemMessage) {
    total += estimateTokenCount(systemMessage) + MESSAGE_OVERHEAD_TOKENS
  }

  // 历史消息
  for (const msg of messages) {
    total += estimateTokenCount(msg.content) + MESSAGE_OVERHEAD_TOKENS
    // reasoning 内容也计入
    if (msg.reasoning) {
      total += estimateTokenCount(msg.reasoning)
    }
  }

  // 当前用户消息
  if (userMessage) {
    total += estimateTokenCount(userMessage) + MESSAGE_OVERHEAD_TOKENS
  }

  // 工具定义开销
  if (toolCount > 0) {
    total += TOOLS_BASE_OVERHEAD_TOKENS * toolCount
  }

  return total
}

/**
 * 从消息列表头部裁剪，使总量低于目标阈值
 *
 * 保留最近的消息，从最旧的开始移除。
 * 至少保留最后一条用户消息。
 *
 * @param messages 原始消息列表
 * @param estimatedTokens 当前估算的 token 总量
 * @param targetTokens 目标 token 数（通常是 contextWindow * threshold）
 * @param systemMessage 系统提示词
 * @param userMessage 当前用户消息
 * @param toolCount 工具数量
 * @returns 裁剪后的消息列表和裁剪数量
 */
export function trimMessagesToTarget(
  messages: ChatMessage[],
  estimatedTokens: number,
  targetTokens: number,
  systemMessage?: string,
  userMessage?: string,
  toolCount: number = 0,
): { trimmed: ChatMessage[]; removedCount: number } {
  if (estimatedTokens <= targetTokens || messages.length === 0) {
    return { trimmed: messages, removedCount: 0 }
  }

  // 从头部逐步移除，直到低于阈值
  let currentMessages = [...messages]
  let currentTokens = estimatedTokens

  while (currentMessages.length > 0 && currentTokens > targetTokens) {
    const removed = currentMessages.shift()!
    // 扣除被移除消息的 token（内容 + 开销）
    currentTokens -= estimateTokenCount(removed.content) + MESSAGE_OVERHEAD_TOKENS
    if (removed.reasoning) {
      currentTokens -= estimateTokenCount(removed.reasoning)
    }
  }

  return {
    trimmed: currentMessages,
    removedCount: messages.length - currentMessages.length,
  }
}
