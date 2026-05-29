/**
 * 上下文前缀/副标题解析
 */
import { getAgentWorkspace } from '../agent/agent-workspace-manager'
import { getAgentSessionMeta } from '../agent/agent-session-manager'

/**
 * 解析消息上下文前缀：[工作区名称]->[会话名称]：
 *
 * 用于在每条回复的飞书消息开头标注来源，方便用户区分。
 */
export function resolveContextPrefix(
  chatId: string,
  getBinding: (chatId: string) => { workspaceId?: string; sessionId: string } | undefined,
): string {
  const binding = getBinding(chatId)
  if (!binding) return ''

  const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
  const session = getAgentSessionMeta(binding.sessionId)

  const wsName = workspace?.name ?? '默认工作区'
  const sessName = session?.title ?? binding.sessionId.slice(0, 8)

  return `[${wsName}]->[${sessName}]：`
}

/** 获取卡片 header subtitle 用的上下文描述 */
export function resolveContextSubtitle(
  chatId: string,
  getBinding: (chatId: string) => { workspaceId?: string; sessionId: string } | undefined,
): string {
  const binding = getBinding(chatId)
  if (!binding) return ''

  const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
  const session = getAgentSessionMeta(binding.sessionId)

  const wsName = workspace?.name ?? '默认工作区'
  const sessName = session?.title ?? binding.sessionId.slice(0, 8)

  return `${wsName} · ${sessName}`
}
