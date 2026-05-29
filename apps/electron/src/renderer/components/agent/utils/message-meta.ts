import type {
  SDKMessage, SDKAssistantMessage, SDKUserMessage, SDKSystemMessage, SDKResultMessage, AgentEventUsage,
} from '@proma/shared'

export interface AssistantTurn {
  type: 'assistant-turn'
  assistantMessages: SDKAssistantMessage[]
  turnMessages: SDKMessage[]
  model?: string
  createdAt?: number
}

export type MessageGroup =
  | { type: 'user'; message: SDKUserMessage }
  | { type: 'system'; message: SDKSystemMessage }
  | AssistantTurn

export function extractMeta(message: SDKMessage): { createdAt?: number } {
  const msg = message as Record<string, unknown>
  return {
    createdAt: typeof msg._createdAt === 'number' ? msg._createdAt : undefined,
  }
}

export function extractTurnUsage(turnMessages: SDKMessage[]): { durationMs?: number; usage?: AgentEventUsage } {
  for (const msg of turnMessages) {
    if (msg.type !== 'result') continue
    const raw = msg as Record<string, unknown>
    const durationMs = typeof raw._durationMs === 'number' ? raw._durationMs : undefined
    const u = (msg as SDKResultMessage).usage
    if (!u) return { durationMs }
    const resultMsg = msg as SDKResultMessage
    const contextWindow = resultMsg.modelUsage
      ? Object.values(resultMsg.modelUsage)[0]?.contextWindow
      : undefined
    return {
      durationMs,
      usage: {
        inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens,
        costUsd: resultMsg.total_cost_usd,
        contextWindow,
      },
    }
  }
  return {}
}

export function extractUserText(message: SDKUserMessage): string | null {
  const content = message.message?.content
  if (!Array.isArray(content)) return null
  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      texts.push((block as { text: string }).text)
    }
  }
  return texts.length > 0 ? texts.join('\n') : null
}

export function isUserInputMessage(message: SDKUserMessage): boolean {
  if (message.parent_tool_use_id) return false
  if (message.isSynthetic) return false
  const content = message.message?.content
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) return false
  return extractUserText(message) !== null
}
