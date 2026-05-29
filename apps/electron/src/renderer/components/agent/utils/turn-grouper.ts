import type { SDKMessage, SDKAssistantMessage, SDKUserMessage, SDKSystemMessage } from '@proma/shared'
import { extractMeta, isUserInputMessage } from './message-meta'
import type { AssistantTurn, MessageGroup } from './message-meta'

export type { AssistantTurn, MessageGroup }

/**
 * 将 SDKMessage 列表分组为可渲染的 Turn
 */
export function groupIntoTurns(messages: SDKMessage[], sessionModelId?: string): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentTurn: AssistantTurn | null = null

  const flushTurn = (): void => {
    if (currentTurn && currentTurn.assistantMessages.length > 0) {
      groups.push(currentTurn)
    }
    currentTurn = null
  }

  for (const msg of messages) {
    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      if (isUserInputMessage(userMsg)) {
        flushTurn()
        groups.push({ type: 'user', message: userMsg })
      } else if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    } else if (msg.type === 'assistant') {
      const aMsg = msg as SDKAssistantMessage
      if (aMsg.isReplay) continue
      if (!currentTurn) {
        const meta = extractMeta(msg)
        currentTurn = {
          type: 'assistant-turn',
          assistantMessages: [aMsg],
          turnMessages: [msg],
          model: aMsg._channelModelId || aMsg.message?.model || sessionModelId,
          createdAt: meta.createdAt,
        }
      } else {
        currentTurn.assistantMessages.push(aMsg)
        currentTurn.turnMessages.push(msg)
      }
    } else if (msg.type === 'system') {
      const sysMsg = msg as SDKSystemMessage
      if (sysMsg.subtype === 'compact_boundary' || sysMsg.subtype === 'compacting' || sysMsg.subtype === 'permission_denied') {
        flushTurn()
        groups.push({ type: 'system', message: sysMsg })
      } else if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    } else {
      if ((msg as { type: string }).type === 'prompt_suggestion') continue
      if (currentTurn) currentTurn.turnMessages.push(msg)
    }
  }

  flushTurn()
  return mergeAdjacentSameModelTurns(groups)
}

function mergeAdjacentSameModelTurns(groups: MessageGroup[]): MessageGroup[] {
  if (groups.length <= 1) return groups
  const result: MessageGroup[] = []
  for (const group of groups) {
    if (group.type !== 'assistant-turn') { result.push(group); continue }
    let mergeTargetIdx = -1
    for (let i = result.length - 1; i >= 0; i--) {
      const prev = result[i]!
      if (prev.type === 'user') break
      if (prev.type === 'system' && ['compact_boundary', 'permission_denied'].includes((prev.message as SDKSystemMessage).subtype ?? '')) break
      if (prev.type === 'assistant-turn') {
        if (prev.model === group.model) mergeTargetIdx = i
        break
      }
    }
    if (mergeTargetIdx >= 0) {
      const target = result[mergeTargetIdx] as AssistantTurn
      target.assistantMessages.push(...group.assistantMessages)
      target.turnMessages.push(...group.turnMessages)
    } else {
      result.push(group)
    }
  }
  return result
}
