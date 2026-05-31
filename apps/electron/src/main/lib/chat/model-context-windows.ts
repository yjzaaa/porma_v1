/**
 * 模型上下文窗口大小查找表
 *
 * 根据 provider + modelId 返回模型的上下文窗口大小（tokens）。
 * 用于 chat-service 在发送前估算 token 用量，防止超出限制。
 */

/** 默认上下文窗口大小（tokens） */
const DEFAULT_CONTEXT_WINDOW = 128_000

/** 上下文窗口使用率阈值，超过此比例触发自动裁剪（模型上限的 1/3） */
export const CONTEXT_USAGE_THRESHOLD = 1 / 3

/**
 * 模型上下文窗口配置
 *
 * key 为模型 ID 的前缀匹配模式（小写），
 * value 为上下文窗口大小（tokens）。
 */
const MODEL_CONTEXT_WINDOWS: Array<{ pattern: string; tokens: number }> = [
  // Anthropic Claude 系列
  { pattern: 'claude-sonnet-4', tokens: 200_000 },
  { pattern: 'claude-opus-4', tokens: 200_000 },
  { pattern: 'claude-haiku', tokens: 200_000 },
  { pattern: 'claude-3-5-sonnet', tokens: 200_000 },
  { pattern: 'claude-3-5-haiku', tokens: 200_000 },
  { pattern: 'claude-3-opus', tokens: 200_000 },
  { pattern: 'claude-3-sonnet', tokens: 200_000 },
  { pattern: 'claude-3-haiku', tokens: 200_000 },

  // OpenAI GPT 系列
  { pattern: 'gpt-4.1', tokens: 1_000_000 },
  { pattern: 'gpt-4o-mini', tokens: 128_000 },
  { pattern: 'gpt-4o', tokens: 128_000 },
  { pattern: 'gpt-4-turbo', tokens: 128_000 },
  { pattern: 'gpt-4-', tokens: 8_192 },
  { pattern: 'gpt-4', tokens: 8_192 },
  { pattern: 'o4-mini', tokens: 200_000 },
  { pattern: 'o3', tokens: 200_000 },
  { pattern: 'o3-mini', tokens: 200_000 },

  // Google Gemini 系列
  { pattern: 'gemini-2.5-pro', tokens: 1_000_000 },
  { pattern: 'gemini-2.5-flash', tokens: 1_000_000 },
  { pattern: 'gemini-2.0-flash', tokens: 1_000_000 },
  { pattern: 'gemini-1.5-pro', tokens: 2_000_000 },
  { pattern: 'gemini-1.5-flash', tokens: 1_000_000 },

  // DeepSeek 系列
  { pattern: 'deepseek-v4', tokens: 128_000 },
  { pattern: 'deepseek-chat', tokens: 128_000 },
  { pattern: 'deepseek-reasoner', tokens: 128_000 },
  { pattern: 'deepseek-', tokens: 128_000 },

  // 智谱 AI
  { pattern: 'glm-4-plus', tokens: 128_000 },
  { pattern: 'glm-4-air', tokens: 128_000 },
  { pattern: 'glm-4-long', tokens: 1_000_000 },
  { pattern: 'glm-4-flash', tokens: 128_000 },
  { pattern: 'glm-4', tokens: 128_000 },

  // MiniMax
  { pattern: 'minimax-', tokens: 128_000 },

  // 豆包（字节跳动）
  { pattern: 'doubao-', tokens: 128_000 },

  // 通义千问
  { pattern: 'qwen-', tokens: 128_000 },
  { pattern: 'qwen2.5-', tokens: 128_000 },
  { pattern: 'qwen3-', tokens: 128_000 },

  // Kimi（月之暗面）
  { pattern: 'moonshot-', tokens: 128_000 },
  { pattern: 'kimi-', tokens: 128_000 },
]

/**
 * 根据模型 ID 获取上下文窗口大小
 *
 * 按列表顺序进行前缀匹配，返回第一个匹配的窗口大小。
 * 未匹配时返回默认值 128K。
 *
 * @param modelId 模型标识符（如 'claude-sonnet-4-6', 'gpt-4o' 等）
 * @returns 上下文窗口大小（tokens）
 */
export function getModelContextWindow(modelId: string): number {
  const lowerModelId = modelId.toLowerCase()
  for (const { pattern, tokens } of MODEL_CONTEXT_WINDOWS) {
    if (lowerModelId.startsWith(pattern)) {
      return tokens
    }
  }
  return DEFAULT_CONTEXT_WINDOW
}
