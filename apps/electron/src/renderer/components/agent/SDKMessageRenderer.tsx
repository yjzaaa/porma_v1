/**
 * SDKMessageRenderer — Strategy Dispatcher
 *
 * Delegates rendering to specialized sub-renderers based on message type.
 * Also exports MessageGroupRenderer for turn-based rendering.
 */

import * as React from 'react'
import { AssistantTurnRenderer, buildHistoricalTaskSubjects } from './renderers/AssistantTurnRenderer'
import { UserInputMessage, CompactBoundaryDivider, CompactingIndicator, PermissionDeniedNotice } from './renderers/UserMessageRenderer'
import { ErrorMessage } from './renderers/ErrorMessageRenderer'
import type { SDKMessage, SDKAssistantMessage, SDKUserMessage, SDKSystemMessage } from '@proma/shared'
import type { MessageGroup, AssistantTurn } from './utils/turn-grouper'

export type { AssistantTurn, MessageGroup }
export { groupIntoTurns } from './utils/turn-grouper'
export { AssistantTurnRenderer, buildHistoricalTaskSubjects } from './renderers/AssistantTurnRenderer'
// Re-exports for backward compatibility (consumed by AgentMessages.tsx)
export { extractUserText } from './utils/message-meta'
export { CompactingIndicator } from './renderers/UserMessageRenderer'
export { parseAttachedFiles, isImageFile } from './renderers/FileAttachmentRenderer'

// ===== SDKMessageRenderer Props =====

export interface SDKMessageRendererProps {
  message: SDKMessage
  allMessages: SDKMessage[]
  basePath?: string
  showHeader?: boolean
  sessionModelId?: string
}

// ===== SDKMessageRenderer — 单条消息渲染 =====

export function SDKMessageRenderer({
  message, allMessages, basePath, showHeader = true, sessionModelId,
}: SDKMessageRendererProps): React.ReactElement | null {
  const msgType = message.type

  if (msgType === 'assistant') {
    const aMsg = message as SDKAssistantMessage
    if (aMsg.isReplay) return null
    if (aMsg.error) return <ErrorMessage message={aMsg} />
    const blocks = aMsg.message?.content
    if (!Array.isArray(blocks) || blocks.length === 0) return null
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages: [aMsg],
      turnMessages: [message],
      model: aMsg._channelModelId || aMsg.message?.model || sessionModelId,
    }
    return <AssistantTurnRenderer turn={turn} allMessages={allMessages} historicalTaskSubjects={new Map()} basePath={basePath} sessionModelId={sessionModelId} />
  }

  if (msgType === 'user') {
    const uMsg = message as SDKUserMessage
    return isUserInputMessage(uMsg) ? <UserInputMessage message={uMsg} /> : null
  }

  if (msgType === 'system') {
    const sysMsg = message as SDKSystemMessage
    if (sysMsg.subtype === 'compact_boundary') return <CompactBoundaryDivider />
    if (sysMsg.subtype === 'permission_denied') return <PermissionDeniedNotice message={sysMsg} />
    return null
  }

  return null
}

// ===== WeakMap cache for group IDs =====

const messageIdCache = new WeakMap<object, string>()
let fallbackIdCounter = 0

export function getGroupId(group: MessageGroup): string {
  if (group.type === 'user') {
    if (group.message.uuid) return group.message.uuid
    const stableKey = (group.message as unknown as Record<string, unknown>)._promaStableKey
    if (typeof stableKey === 'string') return stableKey
    if (!messageIdCache.has(group.message)) messageIdCache.set(group.message, `user-${++fallbackIdCounter}`)
    return messageIdCache.get(group.message)!
  }
  if (group.type === 'system') {
    if (!messageIdCache.has(group.message)) messageIdCache.set(group.message, `system-${group.message.subtype ?? 'unknown'}-${++fallbackIdCounter}`)
    return messageIdCache.get(group.message)!
  }
  const first = group.assistantMessages[0]
  if (first?.uuid) return first.uuid
  const stableKey = first ? (first as unknown as Record<string, unknown>)._promaStableKey : undefined
  if (typeof stableKey === 'string') return stableKey
  if (first) {
    if (!messageIdCache.has(first)) messageIdCache.set(first, `turn-${++fallbackIdCounter}`)
    return messageIdCache.get(first)!
  }
  return `turn-empty-${++fallbackIdCounter}`
}

export function getGroupPreview(group: MessageGroup): string {
  if (group.type === 'user') {
    return (extractUserText(group.message) ?? '')
      .replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '')
      .replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '')
      .slice(0, 200)
  }
  if (group.type === 'system') {
    if (group.message.subtype === 'compact_boundary') return '上下文已压缩'
    if (group.message.subtype === 'compacting') return '正在压缩上下文...'
    if (group.message.subtype === 'permission_denied') return '自动审批已拒绝操作'
    return ''
  }
  const texts: string[] = []
  for (const aMsg of group.assistantMessages) {
    const blocks = aMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type === 'text' && 'text' in block) texts.push((block as { text: string }).text)
    }
  }
  return texts.join(' ').slice(0, 200)
}

export interface MessageGroupRendererProps {
  group: MessageGroup
  allMessages: SDKMessage[]
  historicalTaskSubjects: Map<string, string>
  basePath?: string
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
  isStreaming?: boolean
  stoppedByUser?: boolean
  sessionModelId?: string
}

export function MessageGroupRenderer({
  group, allMessages, historicalTaskSubjects, basePath,
  onFork, onRewind, onRetry, onRetryInNewSession, onCompact,
  isStreaming, stoppedByUser, sessionModelId,
}: MessageGroupRendererProps): React.ReactElement | null {
  const groupId = getGroupId(group)

  if (group.type === 'user') {
    return <div data-message-id={groupId} data-message-role="user"><UserInputMessage message={group.message} /></div>
  }

  if (group.type === 'system') {
    const subtype = group.message.subtype
    if (subtype === 'compact_boundary') return <div data-message-id={groupId}><CompactBoundaryDivider /></div>
    if (subtype === 'compacting') return <div data-message-id={groupId}><CompactingIndicator /></div>
    if (subtype === 'permission_denied') return <div data-message-id={groupId}><PermissionDeniedNotice message={group.message} /></div>
    return null
  }

  return (
    <div data-message-id={groupId} data-message-role="assistant">
      <AssistantTurnRenderer
        turn={group} allMessages={allMessages} historicalTaskSubjects={historicalTaskSubjects}
        basePath={basePath} onFork={onFork} onRewind={onRewind} onRetry={onRetry}
        onRetryInNewSession={onRetryInNewSession} onCompact={onCompact}
        isStreaming={isStreaming} stoppedByUser={stoppedByUser} sessionModelId={sessionModelId}
      />
    </div>
  )
}

// Local helpers (not exported from utils to avoid circular deps)
function extractUserText(message: SDKUserMessage): string | null {
  const content = message.message?.content
  if (!Array.isArray(content)) return null
  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) texts.push((block as { text: string }).text)
  }
  return texts.length > 0 ? texts.join('\n') : null
}

function isUserInputMessage(message: SDKUserMessage): boolean {
  if (message.parent_tool_use_id) return false
  if (message.isSynthetic) return false
  const content = message.message?.content
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) return false
  return extractUserText(message) !== null
}
