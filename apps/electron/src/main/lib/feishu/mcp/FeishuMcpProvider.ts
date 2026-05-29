/**
 * 飞书群聊 MCP 工具提供者
 *
 * 动态构建 MCP Server，给 Agent 提供拉取群聊历史的能力。
 */
import type { FeishuChatMessage } from '@proma/shared'

export interface HistoryFetcher {
  fetch(chatId: string, options?: { pageSize?: number; beforeTimestamp?: number }): Promise<FeishuChatMessage[]>
  formatContext(messages: FeishuChatMessage[]): string
}

export class FeishuMcpProvider {
  constructor(private historyFetcher: HistoryFetcher) {}

  /**
   * 创建飞书群聊 MCP Server
   */
  async createServer(
    chatId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      const { z } = await import('zod')

      const server = sdk.createSdkMcpServer({
        name: 'feishu_chat',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'fetch_group_chat_history',
            '获取飞书群聊的历史消息。' +
            '返回指定数量的历史消息，包含发送者、时间和内容。',
            {
              limit: z.number().min(1).max(50).optional()
                .describe('要获取的消息数量（默认 20，最多 50）'),
              before_timestamp: z.number().optional()
                .describe('获取此时间戳（毫秒）之前的消息，用于向前翻页'),
            },
            async (args) => {
              const messages = await this.historyFetcher.fetch(chatId, {
                pageSize: args.limit,
                beforeTimestamp: args.before_timestamp,
              })

              if (messages.length === 0) {
                return {
                  content: [{ type: 'text' as const, text: '没有更多历史消息。' }],
                }
              }

              const formatted = this.historyFetcher.formatContext(messages)
              const oldestTimestamp = messages[0]?.createTime ?? 0

              return {
                content: [{
                  type: 'text' as const,
                  text: `${formatted}\n\n（如需更早的消息，使用 before_timestamp: ${oldestTimestamp}）`,
                }],
              }
            },
            { annotations: { readOnlyHint: true } },
          ),
        ],
      })

      return server as unknown as Record<string, unknown>
    } catch (error) {
      console.warn('[飞书 MCP] 创建群聊 MCP 工具失败:', error)
      return null
    }
  }
}
