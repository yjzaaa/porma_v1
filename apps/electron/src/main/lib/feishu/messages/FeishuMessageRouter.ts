/**
 * 飞书消息路由
 *
 * 负责消息解析、分类（命令 vs 普通消息）、附件下载、去重检测。
 */
import type { FeishuMessageContext, FeishuMention, AgentSendInput } from '@proma/shared'
import { buildErrorCard } from '../feishu-message'
import { resolveGroupMessageAccess } from '../group-message-policy'
import {
  saveImageToSession,
  saveFileToSession,
  inferExtension,
} from '../../bridge/bridge-attachment-utils'
import { getAgentWorkspace } from '../../agent/agent-workspace-manager'
import type { FeishuImageAttachment, FeishuFileAttachment } from '../types'
import type { FeishuGroupService } from '../group/FeishuGroupService'
import type { FeishuBindingRepository } from '../bindings/FeishuBindingRepository'
import { FeishuAttachmentDownload } from './FeishuAttachmentDownload'
import { FeishuMessageDedup } from './FeishuMessageDedup'
import type { FeishuCommandHandler } from './FeishuCommandHandler'

export interface Sender {
  sendMessage(chatId: string, text: string): Promise<void>
  sendCardMessage(chatId: string, card: Record<string, unknown>): Promise<void>
}

export interface BotConfigSource {
  id: string
  name: string
  defaultWorkspaceId?: string
  defaultChannelId?: string
  defaultModelId?: string
}

export interface StatusUpdater {
  (partial: { activeBindings?: number }): void
}

export class FeishuMessageRouter {
  constructor(
    private bindings: FeishuBindingRepository,
    private dedup: FeishuMessageDedup,
    private attachmentDownload: FeishuAttachmentDownload,
    private commandHandler: FeishuCommandHandler,
    private groupService: FeishuGroupService,
    private botConfig: BotConfigSource,
    private sender: Sender,
    private updateStatus: StatusUpdater,
    private getClient: () => InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null,
    private getBotOpenId: () => string | null,
    private onStartStream: (sessionId: string, chatId: string, headerTitle: string) => Promise<boolean>,
    private onAgentRun: (input: AgentSendInput) => Promise<void>,
  ) {}

  async handle(data: Record<string, unknown>): Promise<void> {
    const client = this.getClient()
    if (!client) return

    // 事件级去重
    const eventId = data.event_id as string | undefined
    if (eventId && this.dedup.isDuplicateEvent(eventId)) return

    const message = (data as { message?: Record<string, unknown> }).message
    if (!message) return
    const sender = (data as { sender?: Record<string, unknown> }).sender

    // 过滤非用户消息
    const senderType = (sender?.sender_type as string) ?? ''
    if (senderType !== 'user') return

    // 消息级去重
    const messageId = message.message_id as string
    if (messageId && this.dedup.isDuplicateMessage(messageId)) return

    const chatId = message.chat_id as string
    const messageType = message.message_type as string
    const chatType = message.chat_type as string
    const userId = (sender?.sender_id as Record<string, unknown>)?.open_id as string ?? 'unknown'
    const mentions = message.mentions as FeishuMention[] | undefined

    // 重入保护
    if (this.dedup.isChatLocked(chatId)) return
    this.dedup.lockChat(chatId)
    try {
      await this.routeMessage({
        chatId,
        messageId,
        messageType,
        chatType,
        userId,
        mentions,
        message,
        sender,
      })
    } finally {
      this.dedup.unlockChat(chatId)
    }
  }

  private async routeMessage(params: {
    chatId: string
    messageId: string
    messageType: string
    chatType: string
    userId: string
    mentions?: FeishuMention[]
    message: Record<string, unknown>
    sender: Record<string, unknown> | undefined
  }): Promise<void> {
    const { chatId, messageId, messageType, chatType, userId, mentions, message: msg } = params

    const existingBinding = this.bindings.get(chatId)
    const isSessionMirrorGroup = existingBinding?.source === 'session-mirror'

    // 群聊权限检测
    if (chatType === 'group') {
      const isMentioned = await this.groupService.isBotMentioned(mentions)
      const groupInfo =
        isSessionMirrorGroup || isMentioned
          ? null
          : await this.groupService.getGroupInfo(chatId)
      const access = resolveGroupMessageAccess({
        isSessionMirrorGroup,
        isBotMentioned: isMentioned,
        groupInfo,
        senderOpenId: userId,
        botOpenId: this.getBotOpenId(),
        binding: existingBinding,
      })
      if (!access.accepted) return
    }

    // 记录群聊最近用户消息 ID（用于 thread reply）
    if (chatType === 'group' && messageId) {
      if ('setLastUserMessageId' in (this.sender as any)) {
        (this.sender as any).setLastUserMessageId(chatId, messageId)
      }
    }

    this.bindings.setLastInteractedUser(userId)

    // 仅处理文本、图片、富文本、文件消息
    const supportedTypes = new Set(['text', 'image', 'post', 'file'])
    if (!supportedTypes.has(messageType)) {
      await this.sender.sendMessage(chatId, '目前仅支持文本、图片和文件消息。')
      return
    }

    // 解析消息内容
    const parseResult = await this.parseMessageContent(
      messageId,
      messageType,
      msg.content as string,
      chatId,
    )
    if (!parseResult) return
    let { text, imageAttachments, fileAttachments } = parseResult

    const hasAttachments = imageAttachments.length > 0 || fileAttachments.length > 0
    if (!text && !hasAttachments) return

    // 纯附件暂存
    if (!text && hasAttachments) {
      await this.handleAttachmentOnly(chatId, imageAttachments, fileAttachments)
      return
    }

    // 合并暂存附件
    if (text && this.pendingImages.has(chatId)) {
      imageAttachments.unshift(...(this.pendingImages.get(chatId)!))
      this.pendingImages.delete(chatId)
    }
    if (text && this.pendingFiles.has(chatId)) {
      fileAttachments.unshift(...(this.pendingFiles.get(chatId)!))
      this.pendingFiles.delete(chatId)
    }

    // 获取群聊上下文
    let groupName: string | undefined
    let senderName: string | undefined
    if (chatType === 'group') {
      const [groupInfo, name] = await Promise.all([
        this.groupService.getGroupInfo(chatId),
        this.groupService.getUserName(userId),
      ])
      groupName = groupInfo?.name
      senderName = name
    }

    const msgCtx: FeishuMessageContext = {
      chatId,
      senderOpenId: userId,
      senderName,
      messageId,
      chatType: chatType as 'p2p' | 'group',
      groupName,
    }

    // 命令路由
    if (text.startsWith('/')) {
      this.dedup.messageQueue.cancel(this.resolveScope(chatId))
      await this.commandHandler.handle(msgCtx, text)
      return
    }

    // 普通消息入队
    const parentMessageId = (msg.parent_id as string | undefined) || undefined
    const scope = this.resolveScope(chatId)
    this.dedup.messageQueue.push(scope, {
      msgCtx,
      text,
      imageAttachments,
      fileAttachments,
      parentMessageId,
    })
  }

  // ===== Attachment Management =====
  // 为了保持原有 pendingImages/pendingFiles 缓存逻辑

  private pendingImages = new Map<string, FeishuImageAttachment[]>()
  private pendingFiles = new Map<string, FeishuFileAttachment[]>()

  private async handleAttachmentOnly(
    chatId: string,
    imageAttachments: FeishuImageAttachment[],
    fileAttachments: FeishuFileAttachment[],
  ): Promise<void> {
    if (imageAttachments.length > 0) {
      const existing = this.pendingImages.get(chatId) ?? []
      existing.push(...imageAttachments)
      this.pendingImages.set(chatId, existing)
    }
    if (fileAttachments.length > 0) {
      const existing = this.pendingFiles.get(chatId) ?? []
      existing.push(...fileAttachments)
      this.pendingFiles.set(chatId, existing)
    }
    const parts: string[] = []
    const imgCount = this.pendingImages.get(chatId)?.length ?? 0
    const fileCount = this.pendingFiles.get(chatId)?.length ?? 0
    if (imgCount > 0) parts.push(`${imgCount} 张图片`)
    if (fileCount > 0) parts.push(`${fileCount} 个文件`)
    await this.sender.sendMessage(chatId, `已收到${parts.join('和')}，请继续发送文字消息来触发处理。`)
  }

  // ===== Message Parsing =====

  private async parseMessageContent(
    messageId: string,
    messageType: string,
    content: string | undefined,
    chatId: string,
  ): Promise<{
    text: string
    imageAttachments: FeishuImageAttachment[]
    fileAttachments: FeishuFileAttachment[]
  } | null> {
    const text = ''
    const imageAttachments: FeishuImageAttachment[] = []
    const fileAttachments: FeishuFileAttachment[] = []

    try {
      switch (messageType) {
        case 'text': {
          const parsed = JSON.parse(content ?? '{}') as { text?: string }
          const rawText = (parsed.text ?? '').replace(/@_user_\d+/g, '').trim()
          return { text: rawText, imageAttachments, fileAttachments }
        }
        case 'post':
          return await this.parseRichText(messageId, content, chatId)
        case 'image':
          return await this.parseImageMessage(messageId, content, chatId)
        case 'file':
          return await this.parseFileMessage(messageId, content, chatId)
        default:
          return null
      }
    } catch (error) {
      console.error('[飞书 Router] 解析消息内容失败:', error)
      return null
    }
  }

  private async parseRichText(
    messageId: string,
    content: string | undefined,
    chatId: string,
  ): Promise<{
    text: string
    imageAttachments: FeishuImageAttachment[]
    fileAttachments: FeishuFileAttachment[]
  } | null> {
    const imageAttachments: FeishuImageAttachment[] = []
    const parsed = JSON.parse(content ?? '{}') as {
      title?: string
      content?: Array<Array<{ tag: string; text?: string; image_key?: string }>>
    }
    const textParts: string[] = []
    if (parsed.title) textParts.push(parsed.title)

    for (const line of parsed.content ?? []) {
      for (const node of line) {
        if (node.tag === 'text' && node.text) {
          textParts.push(node.text)
        } else if (node.tag === 'img' && node.image_key) {
          try {
            const attachment = await this.attachmentDownload.downloadImageAttachment(
              messageId,
              node.image_key,
            )
            imageAttachments.push(attachment)
          } catch (error) {
            console.error('[飞书 Router] 下载富文本图片失败:', error)
          }
        }
      }
    }

    return {
      text: textParts.join(' ').replace(/@_user_\d+/g, '').trim(),
      imageAttachments,
      fileAttachments: [],
    }
  }

  private async parseImageMessage(
    messageId: string,
    content: string | undefined,
    chatId: string,
  ): Promise<{
    text: string
    imageAttachments: FeishuImageAttachment[]
    fileAttachments: FeishuFileAttachment[]
  } | null> {
    const parsed = JSON.parse(content ?? '{}') as { image_key?: string }
    if (!parsed.image_key) return { text: '', imageAttachments: [], fileAttachments: [] }

    try {
      const attachment = await this.attachmentDownload.downloadImageAttachment(
        messageId,
        parsed.image_key,
      )
      if (attachment.data.length > 10 * 1024 * 1024) {
        console.warn(`[飞书 Router] 图片较大: ${(attachment.data.length / 1024 / 1024).toFixed(1)}MB`)
      }
      return { text: '', imageAttachments: [attachment], fileAttachments: [] }
    } catch (error) {
      console.error('[飞书 Router] 下载图片失败:', error)
      await this.sender.sendCardMessage(chatId, buildErrorCard('图片下载失败，请重试。'))
      return null
    }
  }

  private async parseFileMessage(
    messageId: string,
    content: string | undefined,
    chatId: string,
  ): Promise<{
    text: string
    imageAttachments: FeishuImageAttachment[]
    fileAttachments: FeishuFileAttachment[]
  } | null> {
    const parsed = JSON.parse(content ?? '{}') as {
      file_key?: string
      file_name?: string
    }
    if (!parsed.file_key) return { text: '', imageAttachments: [], fileAttachments: [] }

    try {
      const attachment = await this.attachmentDownload.downloadFileAttachment(
        messageId,
        parsed.file_key,
        parsed.file_name,
      )
      if (attachment.data.length > 50 * 1024 * 1024) {
        await this.sender.sendMessage(chatId, '文件过大（超过 50MB），暂不支持处理。')
        return null
      }
      return { text: '', imageAttachments: [], fileAttachments: [attachment] }
    } catch (error) {
      console.error('[飞书 Router] 下载文件失败:', error)
      await this.sender.sendCardMessage(chatId, buildErrorCard('文件下载失败，请重试。'))
      return null
    }
  }

  /** 保存附件到 session 工作目录 */
  async saveAttachments(
    sessionId: string,
    workspaceId: string | undefined,
    imageAttachments: FeishuImageAttachment[],
    fileAttachments: FeishuFileAttachment[],
  ): Promise<string> {
    const attachedRefs: string[] = []
    const workspace = workspaceId ? getAgentWorkspace(workspaceId) : undefined
    if (!workspace) return ''

    for (const img of imageAttachments) {
      try {
        const savedPath = saveImageToSession(
          workspace.slug,
          sessionId,
          `feishu-${img.imageKey}`,
          img.mediaType,
          img.data,
        )
        attachedRefs.push(`- feishu-${img.imageKey}.${inferExtension(img.mediaType)}: ${savedPath}`)
      } catch (err) {
        console.error(`[飞书 Router] 图片保存失败:`, err)
      }
    }
    for (const file of fileAttachments) {
      try {
        const savedPath = saveFileToSession(
          workspace.slug,
          sessionId,
          file.fileName,
          file.data,
        )
        attachedRefs.push(`- ${file.fileName}: ${savedPath}`)
      } catch (err) {
        console.error(`[飞书 Router] 文件保存失败:`, err)
      }
    }

    return attachedRefs.length > 0
      ? `<attached_files>\n${attachedRefs.join('\n')}\n</attached_files>\n\n`
      : ''
  }

  private resolveScope(chatId: string): string {
    return chatId
  }

  /** 替换 sender 引用（Mediator 在 connection.start() 后更新 client） */
  setSender(sender: Sender): void {
    this.sender = sender
  }

  /** 暴露给 flush 回调使用的 lastUserMessageId */
  get lastUserMessageId(): Map<string, string> {
    if ('getLastUserMessageIdMap' in (this.sender as any)) {
      return (this.sender as any).getLastUserMessageIdMap()
    }
    return new Map()
  }
}
