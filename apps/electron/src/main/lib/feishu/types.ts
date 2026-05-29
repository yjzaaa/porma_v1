/**
 * feishu-bridge 内部类型定义
 */
import type { ToolSummary } from './feishu-message'
import type {
  FeishuMessageContext,
} from '@proma/shared'

/** 飞书图片附件（已下载，待保存到 session 工作目录） */
export interface FeishuImageAttachment {
  /** 飞书 image_key */
  imageKey: string
  /** 图片二进制数据 */
  data: Buffer
  /** MIME 类型 */
  mediaType: string
}

/** 飞书文件附件（已下载，待保存到 session 工作目录） */
export interface FeishuFileAttachment {
  /** 飞书 file_key */
  fileKey: string
  /** 原始文件名 */
  fileName: string
  /** 文件二进制数据 */
  data: Buffer
}

/** 会话累积缓冲 */
export interface SessionBuffer {
  text: string
  toolSummaries: Map<string, ToolSummary>
  startedAt: number
}

/** 进入 ScopedQueue 防抖队列的飞书消息载荷 */
export interface QueuedFeishuMessage {
  msgCtx: FeishuMessageContext
  text: string
  imageAttachments: FeishuImageAttachment[]
  fileAttachments: FeishuFileAttachment[]
  /** 用户长按"回复"指向的消息 id（飞书 message.parent_id） */
  parentMessageId?: string
}
