/**
 * 飞书消息附件下载
 */
import type { FeishuImageAttachment, FeishuFileAttachment } from '../types'
import { inferImageMediaType } from '../../bridge-attachment-utils'

export class FeishuAttachmentDownload {
  constructor(
    private getClient: () => InstanceType<
      typeof import('@larksuiteoapi/node-sdk').Client
    > | null,
  ) {}

  /**
   * 从飞书下载图片
   */
  async downloadImage(
    messageId: string,
    imageKey: string,
  ): Promise<Buffer> {
    const client = this.getClient()
    if (!client) throw new Error('飞书 Client 未初始化')

    const resp = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    })

    const stream = resp.getReadableStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  /**
   * 下载飞书消息中的文件资源
   */
  async downloadFile(
    messageId: string,
    fileKey: string,
  ): Promise<Buffer> {
    const client = this.getClient()
    if (!client) throw new Error('飞书 Client 未初始化')

    const resp = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: 'file' },
    })

    const stream = resp.getReadableStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  /**
   * 下载飞书图片并构建 FeishuImageAttachment
   */
  async downloadImageAttachment(
    messageId: string,
    imageKey: string,
  ): Promise<FeishuImageAttachment> {
    const data = await this.downloadImage(messageId, imageKey)
    const mediaType = inferImageMediaType(data)
    return { imageKey, data, mediaType }
  }

  /**
   * 下载飞书文件并构建 FeishuFileAttachment
   */
  async downloadFileAttachment(
    messageId: string,
    fileKey: string,
    fileName?: string,
  ): Promise<FeishuFileAttachment> {
    const data = await this.downloadFile(messageId, fileKey)
    return {
      fileKey,
      fileName: fileName || `feishu-${fileKey}`,
      data,
    }
  }
}
