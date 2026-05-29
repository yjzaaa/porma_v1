/**
 * WebSocket 连接生命周期管理
 *
 * 封装 LarkChannel 的创建、连接、断开和消息接收。
 */
import type { FeishuBotConfig, FeishuBridgeState } from '@proma/shared'
import { getDecryptedBotAppSecret } from '../feishu-config'

export interface FeishuMessageHandler {
  (data: Record<string, unknown>): void
}

export class FeishuConnection {
  private _client: InstanceType<
    typeof import('@larksuiteoapi/node-sdk').Client
  > | null = null

  private _channel: import('@larksuiteoapi/node-sdk').LarkChannel | null = null

  private _botOpenId: string | null = null

  private _status: FeishuBridgeState = { status: 'disconnected', activeBindings: 0 }

  private messageHandler: FeishuMessageHandler | null = null

  get client() {
    return this._client
  }

  get channel() {
    return this._channel
  }

  get botOpenId() {
    return this._botOpenId
  }

  get status() {
    return { ...this._status }
  }

  onMessage(handler: FeishuMessageHandler): void {
    this.messageHandler = handler
  }

  async start(botConfig: FeishuBotConfig): Promise<void> {
    const { appId, appSecret } = botConfig
    if (!appId || !appSecret) {
      throw new Error('请先配置 App ID 和 App Secret')
    }

    this._status = { status: 'connecting' }

    try {
      const plainSecret = getDecryptedBotAppSecret(botConfig.id)
      const lark = await import('@larksuiteoapi/node-sdk')

      this._channel = lark.createLarkChannel({
        appId,
        appSecret: plainSecret,
        domain: lark.Domain.Feishu,
        loggerLevel: lark.LoggerLevel.warn,
        policy: {
          dmMode: 'open',
          requireMention: false,
          respondToMentionAll: false,
        },
        safety: { chatQueue: { enabled: false } },
        includeRawEvent: true,
      })
      this._client = this._channel.rawClient

      // 获取 Bot 自身 open_id
      await this.fetchBotOpenId()

      // 注册消息接收
      this._channel.on({
        message: (msg) => {
          const raw = (msg as { raw?: Record<string, unknown> }).raw ?? {}
          this.messageHandler?.(raw)
        },
      })

      await this._channel.connect()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this._status = { status: 'error', errorMessage: message }
      throw error
    }
  }

  private async fetchBotOpenId(): Promise<void> {
    if (!this._client) return

    try {
      const botInfoResp = await this._client.request<{
        code?: number
        bot?: { open_id?: string; app_name?: string }
        data?: { bot?: { open_id?: string; app_name?: string } }
      }>({
        method: 'GET',
        url: 'https://open.feishu.cn/open-apis/bot/v3/info/',
      })
      this._botOpenId =
        botInfoResp?.bot?.open_id ?? botInfoResp?.data?.bot?.open_id ?? null
    } catch (error) {
      console.warn('[飞书 Connection] 获取 Bot info 失败（非致命）:', error)
    }
  }

  /** 延迟获取 Bot open_id（用于 isBotMentioned 回退） */
  async refreshBotOpenId(): Promise<string | null> {
    await this.fetchBotOpenId()
    return this._botOpenId
  }

  disconnect(): void {
    if (this._channel) {
      void this._channel.disconnect().catch(() => {})
      this._channel = null
    }
    this._client = null
    this._botOpenId = null
    this._status = { status: 'disconnected', activeBindings: 0 }
  }

  setStatus(status: FeishuBridgeState): void {
    this._status = status
  }

  updateStatus(partial: Partial<FeishuBridgeState>): void {
    this._status = { ...this._status, ...partial }
  }
}
