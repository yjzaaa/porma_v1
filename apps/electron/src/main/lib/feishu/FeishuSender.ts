/**
 * 飞书消息发送统一封装
 *
 * 封装文本/卡片消息的发送、群聊 thread reply 选择。
 */
import type { FeishuChatBinding } from '@proma/shared'

export interface SendDeps {
  client: InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null
  getBinding: (chatId: string) => FeishuChatBinding | undefined
  getLastUserMessageId: (chatId: string) => string | undefined
  trackSentMessage: (messageId: string) => void
}

export class FeishuSender {
  /** chatId → 最近收到的用户消息 ID（用于群聊 thread reply） */
  private lastUserMessageId = new Map<string, string>()

  constructor(private deps: SendDeps) {}

  setLastUserMessageId(chatId: string, messageId: string): void {
    this.lastUserMessageId.set(chatId, messageId)
  }

  getLastUserMessageId(chatId: string): string | undefined {
    return this.lastUserMessageId.get(chatId)
  }

  /** 清除群聊 thread reply 记录（Session Mirror 启动时） */
  clearLastUserMessageId(chatId: string): void {
    this.lastUserMessageId.delete(chatId)
  }

  /** 获取完整映射（供 MessageRouter 查询） */
  getLastUserMessageIdMap(): Map<string, string> {
    return this.lastUserMessageId
  }
  async sendMessage(chatId: string, text: string): Promise<void> {
    const binding = this.deps.getBinding(chatId)
    const replyToId =
      binding?.chatType === 'group' ? this.lastUserMessageId.get(chatId) : undefined

    if (replyToId) {
      await this.replyText(replyToId, text)
    } else {
      await this.sendText(chatId, text)
    }
  }

  /** 发送卡片消息到聊天（自动选择回复或新建） */
  async sendCardMessage(chatId: string, card: Record<string, unknown>): Promise<void> {
    const binding = this.deps.getBinding(chatId)
    const replyToId =
      binding?.chatType === 'group' ? this.lastUserMessageId.get(chatId) : undefined

    if (replyToId) {
      await this.replyCard(replyToId, card)
    } else {
      await this.sendCard(chatId, card)
    }
  }

  // ===== 文本 =====

  private async sendText(chatId: string, text: string): Promise<void> {
    if (!this.deps.client) return
    try {
      const resp = await this.deps.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      })
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.deps.trackSentMessage(sentId)
    } catch (error) {
      console.error('[飞书 Sender] 发送文本消息失败:', error)
    }
  }

  private async replyText(messageId: string, text: string): Promise<void> {
    if (!this.deps.client) return
    try {
      const resp = await this.deps.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      })
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.deps.trackSentMessage(sentId)
    } catch (error) {
      console.error('[飞书 Sender] 回复文本消息失败:', error)
    }
  }

  // ===== 卡片 =====

  private async sendCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.deps.client) return
    try {
      const resp = await this.deps.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      })
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.deps.trackSentMessage(sentId)
    } catch (error) {
      console.error('[飞书 Sender] 发送卡片消息失败:', error)
    }
  }

  private async replyCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.deps.client) return
    try {
      const resp = await this.deps.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(card),
          msg_type: 'interactive',
        },
      })
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.deps.trackSentMessage(sentId)
    } catch (error) {
      console.error('[飞书 Sender] 回复卡片消息失败:', error)
    }
  }
}
