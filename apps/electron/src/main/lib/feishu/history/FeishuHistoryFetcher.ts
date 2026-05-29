/**
 * 群聊历史消息拉取与格式化
 */
import type { FeishuChatMessage } from '@proma/shared'

export class FeishuHistoryFetcher {
  private static readonly DEFAULT_HISTORY_COUNT = 20

  constructor(
    private getClient: () => InstanceType<
      typeof import('@larksuiteoapi/node-sdk').Client
    > | null,
    private getUserName: (openId: string) => Promise<string>,
  ) {}

  /**
   * 获取聊天历史消息
   */
  async fetch(
    chatId: string,
    options?: {
      pageSize?: number
      beforeTimestamp?: number
    },
  ): Promise<FeishuChatMessage[]> {
    const client = this.getClient()
    if (!client) return []

    try {
      const pageSize = Math.min(
        options?.pageSize ?? FeishuHistoryFetcher.DEFAULT_HISTORY_COUNT,
        50,
      )
      const endTime = options?.beforeTimestamp
        ? Math.floor(options.beforeTimestamp / 1000).toString()
        : undefined

      const resp = await client.im.message.list({
        params: {
          container_id_type: 'chat',
          container_id: chatId,
          sort_type: 'ByCreateTimeDesc',
          page_size: pageSize,
          ...(endTime && { end_time: endTime }),
        },
      })

      if (resp.code !== 0) {
        console.warn('[飞书 History] 获取聊天历史失败:', resp.msg)
        return []
      }

      const items = resp.data?.items ?? []
      const messages: FeishuChatMessage[] = []

      for (const item of items) {
        if (item.deleted) continue

        const senderId = item.sender?.id ?? 'unknown'
        const senderType = (item.sender?.sender_type ?? 'unknown') as FeishuChatMessage['senderType']
        const msgType = item.msg_type ?? 'unknown'
        const createTime = Number(item.create_time ?? 0)
        const content = this.parseContent(msgType, item.body?.content)

        messages.push({
          messageId: item.message_id ?? '',
          senderId,
          senderType,
          msgType,
          content,
          createTime,
        })
      }

      messages.reverse()
      await this.resolveSenderNames(messages)
      return messages
    } catch (error) {
      console.warn('[飞书 History] 获取聊天历史异常:', error)
      return []
    }
  }

  /**
   * 格式化历史消息为 Agent 可读上下文
   */
  formatContext(messages: FeishuChatMessage[]): string {
    if (messages.length === 0) return ''

    const lines = messages.map((msg) => {
      const time = new Date(msg.createTime).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
      const sender = msg.senderName ?? msg.senderId.slice(0, 8)
      const role = msg.senderType === 'app' ? 'Bot' : sender
      return `[${time}] ${role}: ${msg.content}`
    })

    return [
      '--- 群聊历史消息（最近） ---',
      ...lines,
      '--- 历史消息结束 ---',
    ].join('\n')
  }

  // ===== 私有 =====

  private parseContent(msgType: string, rawContent?: string): string {
    if (!rawContent) return '[空消息]'
    try {
      switch (msgType) {
        case 'text': {
          const parsed = JSON.parse(rawContent) as { text?: string }
          return parsed.text ?? ''
        }
        case 'post': {
          const parsed = JSON.parse(rawContent) as {
            title?: string
            content?: Array<Array<{ tag: string; text?: string }>>
          }
          const parts: string[] = []
          if (parsed.title) parts.push(parsed.title)
          for (const line of parsed.content ?? []) {
            const lineText = line
              .filter((el) => el.tag === 'text' && el.text)
              .map((el) => el.text)
              .join('')
            if (lineText) parts.push(lineText)
          }
          return parts.join('\n') || '[富文本消息]'
        }
        case 'interactive': return '[交互卡片]'
        case 'image': return '[图片]'
        case 'file': return '[文件]'
        case 'audio': return '[语音]'
        case 'media': return '[视频]'
        case 'sticker': return '[表情]'
        case 'share_chat': return '[群名片]'
        case 'share_user': return '[个人名片]'
        default: return `[${msgType}]`
      }
    } catch {
      return `[${msgType}]`
    }
  }

  private async resolveSenderNames(messages: FeishuChatMessage[]): Promise<void> {
    const uniqueUserIds = new Set<string>()
    for (const msg of messages) {
      if (msg.senderType === 'user') {
        uniqueUserIds.add(msg.senderId)
      }
    }
    const userIds = Array.from(uniqueUserIds)
    await Promise.allSettled(userIds.map((id) => this.getUserName(id)))
    // 重建 senderName（依赖外部 cache）
    for (const msg of messages) {
      if (msg.senderType === 'user') {
        msg.senderName = msg.senderId // 外部 cache 会在 getUserName 中填充
      } else if (msg.senderType === 'app') {
        msg.senderName = 'Bot'
      }
    }
  }
}
