/**
 * 群信息获取 + 成员缓存
 */
import type { FeishuMention, FeishuGroupInfo, FeishuGroupMember } from '@proma/shared'

interface UserNameCacheEntry {
  name: string
  cachedAt: number
}

export class FeishuGroupService {
  /** chatId → 群聊信息缓存 */
  private groupInfoCache = new Map<string, FeishuGroupInfo & { cachedAt: number }>()
  /** open_id → 用户显示名称缓存（含时间戳） */
  private userNameCache = new Map<string, UserNameCacheEntry>()
  /** 群信息缓存有效期（毫秒） */
  private static readonly GROUP_CACHE_TTL = 3600_000
  /** 用户名缓存有效期（毫秒） */
  private static readonly USER_CACHE_TTL = 3600_000

  constructor(
    private getClient: () => InstanceType<
      typeof import('@larksuiteoapi/node-sdk').Client
    > | null,
    private getBotOpenId: () => string | null,
  ) {}

  /** 获取缓存的群信息（无网络请求），用于 @Name → <at> 转换 */
  getCachedGroupInfo(chatId: string): (FeishuGroupInfo & { cachedAt: number }) | undefined {
    return this.groupInfoCache.get(chatId)
  }

  clear(): void {
    this.groupInfoCache.clear()
    this.userNameCache.clear()
  }

  /**
   * 获取群聊信息（带缓存）
   */
  async getGroupInfo(chatId: string): Promise<FeishuGroupInfo | null> {
    const cached = this.groupInfoCache.get(chatId)
    if (cached && Date.now() - cached.cachedAt < FeishuGroupService.GROUP_CACHE_TTL) {
      return cached
    }

    const client = this.getClient()
    if (!client) return null

    try {
      const [chatResp, members] = await Promise.all([
        client.im.chat.get({ path: { chat_id: chatId } }),
        this.fetchGroupMembers(chatId),
      ])
      const name = chatResp?.data?.name ?? '未知群组'
      const description = chatResp?.data?.description

      const info: FeishuGroupInfo & { cachedAt: number } = {
        chatId,
        name,
        description,
        members,
        cachedAt: Date.now(),
      }
      this.groupInfoCache.set(chatId, info)

      // 同时填充 userNameCache
      for (const m of members) {
        this.userNameCache.set(m.openId, { name: m.name, cachedAt: Date.now() })
      }

      return info
    } catch (error) {
      console.warn('[飞书 GroupSvc] 获取群聊信息失败:', error)
      return null
    }
  }

  /**
   * 获取用户显示名称（带缓存）
   */
  async getUserName(openId: string): Promise<string> {
    const cached = this.userNameCache.get(openId)
    if (cached && Date.now() - cached.cachedAt < FeishuGroupService.USER_CACHE_TTL) {
      return cached.name
    }

    const client = this.getClient()
    if (!client) return openId.slice(0, 8)

    try {
      const resp = await client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: 'open_id' },
      })
      const name = resp?.data?.user?.name
      if (name) {
        this.userNameCache.set(openId, { name, cachedAt: Date.now() })
        return name
      }
    } catch (error) {
      console.warn('[飞书 GroupSvc] 获取用户信息失败:', error)
    }
    return openId.slice(0, 8)
  }

  /**
   * 批量预加载用户名称
   */
  async preloadUserNames(openIds: string[]): Promise<void> {
    const uniqueIds = openIds.filter((id) => !this.userNameCache.has(id)).slice(0, 10)
    await Promise.allSettled(uniqueIds.map((id) => this.getUserName(id)))
  }

  /**
   * 检测消息是否 @Bot
   */
  async isBotMentioned(mentions: FeishuMention[] | undefined): Promise<boolean> {
    if (!mentions || mentions.length === 0) return false

    const mentionIds = mentions
      .map((m) => ({ name: m.name, openId: extractMentionOpenId(m) }))
      .filter((m) => m.openId && m.openId !== 'all')
    if (mentionIds.length === 0) return false

    const botOpenId = this.getBotOpenId()
    if (!botOpenId) {
      console.warn('[飞书 GroupSvc] botOpenId 未获取，无法精确匹配')
      return false
    }

    return mentionIds.some((m) => m.openId === botOpenId)
  }

  // ===== 私有 =====

  private async fetchGroupMembers(chatId: string): Promise<FeishuGroupMember[]> {
    const client = this.getClient()
    if (!client) return []

    try {
      const resp = await client.im.chatMembers.get({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id', page_size: 100 },
      })
      const items = resp?.data?.items ?? []
      return items
        .filter((item) => item.member_id && item.name)
        .map((item) => ({ openId: item.member_id!, name: item.name! }))
    } catch (error) {
      console.warn('[飞书 GroupSvc] 获取群成员列表失败:', error)
      return []
    }
  }
}

/**
 * 从 mention.id 中提取 open_id
 */
function extractMentionOpenId(mention: FeishuMention): string | null {
  const { id } = mention
  if (typeof id === 'string') return id
  if (typeof id === 'object' && id !== null) return (id as { open_id?: string }).open_id ?? null
  return null
}
