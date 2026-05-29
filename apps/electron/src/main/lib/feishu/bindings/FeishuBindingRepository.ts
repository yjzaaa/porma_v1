/**
 * 聊天绑定 CRUD + 元数据持久化
 *
 * 管理 chatId ↔ sessionId 的双向映射，支持持久化到磁盘。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  FeishuChatBinding,
  FeishuUpdateBindingInput,
  AgentSessionMeta,
} from '@proma/shared'
import { getFeishuBotBindingsPath, getFeishuBotMetadataPath } from '../../config-paths'
import { getAgentSessionMeta } from '../../agent-session-manager'
import { getSettings } from '../../settings-service'

export interface Metadata {
  lastInteractedUserOpenId?: string
}

export class FeishuBindingRepository {
  /** chatId → 绑定信息 */
  private chatBindings = new Map<string, FeishuChatBinding>()
  /** sessionId → chatId（反向索引） */
  private sessionToChat = new Map<string, string>()
  /** 最近与该 Bot 交互的用户 open_id */
  private lastInteractedUserOpenId: string | null = null

  constructor(private botId: string) {}

  // ===== 查询 =====

  get(chatId: string): FeishuChatBinding | undefined {
    return this.chatBindings.get(chatId)
  }

  list(): FeishuChatBinding[] {
    return Array.from(this.chatBindings.values())
  }

  findBySessionId(sessionId: string): FeishuChatBinding | undefined {
    const chatId = this.sessionToChat.get(sessionId)
    if (chatId) return this.chatBindings.get(chatId)
    return Array.from(this.chatBindings.values()).find(
      (b) => b.sessionId === sessionId,
    )
  }

  getChatIdBySessionId(sessionId: string): string | undefined {
    return this.sessionToChat.get(sessionId)
  }

  getLastInteractedUserOpenId(): string | null {
    if (this.lastInteractedUserOpenId && this.lastInteractedUserOpenId !== 'unknown') {
      return this.lastInteractedUserOpenId
    }
    for (const binding of this.chatBindings.values()) {
      if (binding.userId && binding.userId !== 'unknown') return binding.userId
    }
    return null
  }

  get size(): number {
    return this.chatBindings.size
  }

  // ===== 修改 =====

  set(chatId: string, binding: FeishuChatBinding): void {
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(binding.sessionId, chatId)
  }

  update(input: FeishuUpdateBindingInput): FeishuChatBinding | null {
    const binding = this.chatBindings.get(input.chatId)
    if (!binding) return null

    if (input.workspaceId !== undefined) {
      binding.workspaceId = input.workspaceId
    }
    if (input.sessionId !== undefined) {
      this.sessionToChat.delete(binding.sessionId)
      binding.sessionId = input.sessionId
      this.sessionToChat.set(input.sessionId, input.chatId)
    }
    return { ...binding }
  }

  remove(chatId: string): boolean {
    const binding = this.chatBindings.get(chatId)
    if (!binding) return false
    this.sessionToChat.delete(binding.sessionId)
    this.chatBindings.delete(chatId)
    return true
  }

  setLastInteractedUser(openId: string | null): void {
    if (this.lastInteractedUserOpenId === openId) return
    this.lastInteractedUserOpenId = openId
    this.saveMetadata()
  }

  /** 清理旧绑定反向索引（不删除绑定本身） */
  clearSessionRef(sessionId: string): void {
    this.sessionToChat.delete(sessionId)
  }

  // ===== 持久化 =====

  load(): void {
    this.loadBindings()
    this.loadMetadata()
  }

  saveBindings(): void {
    try {
      const bindings = Array.from(this.chatBindings.values())
      const bindingsPath = getFeishuBotBindingsPath(this.botId)
      writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2), 'utf-8')
    } catch (error) {
      console.error('[飞书 BindingRepo] 保存绑定失败:', error)
    }
  }

  saveMetadata(): void {
    try {
      const metaPath = getFeishuBotMetadataPath(this.botId)
      const data: Metadata = {
        lastInteractedUserOpenId: this.lastInteractedUserOpenId ?? undefined,
      }
      writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('[飞书 BindingRepo] 保存元数据失败:', error)
    }
  }

  clear(): void {
    this.chatBindings.clear()
    this.sessionToChat.clear()
  }

  // ===== 私有 =====

  private loadBindings(): void {
    const bindingsPath = getFeishuBotBindingsPath(this.botId)
    if (!existsSync(bindingsPath)) return

    try {
      const raw = readFileSync(bindingsPath, 'utf-8')
      const bindings = JSON.parse(raw) as FeishuChatBinding[]
      const appSettings = getSettings()

      for (const b of bindings) {
        const session = getAgentSessionMeta(b.sessionId)
        if (session) {
          if (appSettings.agentChannelId) b.channelId = appSettings.agentChannelId
          if (appSettings.agentModelId) b.modelId = appSettings.agentModelId
          this.chatBindings.set(b.chatId, b)
          this.sessionToChat.set(b.sessionId, b.chatId)
        }
      }
    } catch (error) {
      console.error('[飞书 BindingRepo] 加载绑定失败:', error)
    }
  }

  private loadMetadata(): void {
    const metaPath = getFeishuBotMetadataPath(this.botId)
    if (!existsSync(metaPath)) return

    try {
      const raw = readFileSync(metaPath, 'utf-8')
      const data = JSON.parse(raw) as Metadata
      if (
        data.lastInteractedUserOpenId &&
        data.lastInteractedUserOpenId !== 'unknown'
      ) {
        this.lastInteractedUserOpenId = data.lastInteractedUserOpenId
      }
    } catch (error) {
      console.error('[飞书 BindingRepo] 加载元数据失败:', error)
    }
  }
}
