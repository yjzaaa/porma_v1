import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import {
  agentStreamingStatesAtom,
  agentSessionStreamingStateAtomFamily,
  agentStreamErrorsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentSessionsAtom,
  agentMessageRefreshAtom,
  agentDiffRefreshVersionAtom,
} from '@/atoms/agent-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import type { SDKMessage } from '@proma/shared'

export interface AgentRetryResult {
  retry: () => void
  retryInNewSession: () => Promise<void>
  fork: (upToMessageUuid: string) => Promise<void>
  rewindRequest: (assistantMessageUuid: string) => void
  rewindConfirm: () => Promise<void>
  rewindTargetUuid: string | null
  setRewindTargetUuid: (uuid: string | null) => void
  getUserTextFromSDKMessage: (message: SDKMessage) => string | null
}

export function useAgentRetry(
  sessionId: string,
  persistedSDKMessages: SDKMessage[],
): AgentRetryResult {
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const streaming = streamState?.running ?? false
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const openSession = useOpenSession()
  const store = useStore()
  const [rewindTargetUuid, setRewindTargetUuid] = React.useState<string | null>(null)

  const getUserTextFromSDKMessage = React.useCallback((message: SDKMessage): string | null => {
    const sdkMessage = message as unknown as {
      type?: string; parent_tool_use_id?: string | null; isSynthetic?: boolean
      message?: { content?: unknown }
    }
    if (sdkMessage.type !== 'user' || sdkMessage.parent_tool_use_id || sdkMessage.isSynthetic) return null
    const content = sdkMessage.message?.content
    if (!Array.isArray(content)) return null
    if (content.some((block) => typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'tool_result')) return null
    const texts = content
      .filter((block) => typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text' && typeof (block as Record<string, string>).text === 'string')
      .map((block) => (block as { text: string }).text)
    return texts.length > 0 ? texts.join('\n') : null
  }, [])

  const retry = React.useCallback((): void => {
    if (!agentChannelId || streaming) return

    const lastUserMessage = [...persistedSDKMessages]
      .reverse()
      .map(getUserTextFromSDKMessage)
      .find((text): text is string => text !== null)
    if (!lastUserMessage) return

    setAgentStreamErrors((prev) => { if (!prev.has(sessionId)) return prev; const map = new Map(prev); map.delete(sessionId); return map })

    const streamStartedAt = Date.now()
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const existing = prev.get(sessionId)
      map.set(sessionId, {
        running: true, content: '', toolActivities: [], model: agentModelId || undefined,
        startedAt: streamStartedAt, inputTokens: existing?.inputTokens, contextWindow: existing?.contextWindow,
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId, userMessage: lastUserMessage, channelId: agentChannelId,
      modelId: agentModelId || undefined, workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
    }).catch(console.error)
  }, [persistedSDKMessages, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setAgentStreamErrors, setStreamingStates, getUserTextFromSDKMessage])

  const retryInNewSession = React.useCallback(async (): Promise<void> => {
    if (!agentChannelId) return
    try {
      const meta = await window.electronAPI.createAgentSession(undefined, agentChannelId, currentWorkspaceId || undefined)
      setAgentSessions((prev) => [meta, ...prev])
      openSession('agent', meta.id, meta.title)

      const prompt = `请读取 &session:${sessionId} 的历史，然后从上个会话停止的位置继续。`
      const streamStartedAt = Date.now()

      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(meta.id, {
          running: true, content: '', toolActivities: [], model: agentModelId || undefined, startedAt: streamStartedAt,
        })
        return map
      })

      window.electronAPI.sendAgentMessage({
        sessionId: meta.id, userMessage: prompt, channelId: agentChannelId,
        modelId: agentModelId || undefined, workspaceId: currentWorkspaceId || undefined,
        mentionedSessionIds: [sessionId], startedAt: streamStartedAt,
      }).catch(console.error)
    } catch (error) {
      console.error('[AgentView] 在新会话中重试失败:', error)
    }
  }, [sessionId, agentChannelId, agentModelId, currentWorkspaceId, openSession, setAgentSessions, setStreamingStates])

  const fork = React.useCallback(async (upToMessageUuid: string): Promise<void> => {
    try {
      const meta = await window.electronAPI.forkAgentSession({ sessionId, upToMessageUuid })
      setAgentSessions((prev) => [meta, ...prev])
      openSession('agent', meta.id, meta.title)
      toast.success('已创建分叉会话', { description: meta.title })
    } catch (error) {
      console.error('[AgentView] 分叉会话失败:', error)
      const rawMsg = error instanceof Error ? error.message : '未知错误'
      const friendlyDesc = /not found in session/i.test(rawMsg)
        ? '该消息无法作为分叉起点（可能属于子代理执行过程或已被清理）。请选择主对话中的其他消息再试。'
        : rawMsg
      toast.error('分叉会话失败', { description: friendlyDesc })
    }
  }, [sessionId, openSession, setAgentSessions])

  const rewindRequest = React.useCallback((assistantMessageUuid: string): void => {
    setRewindTargetUuid(assistantMessageUuid)
  }, [])

  const rewindConfirm = React.useCallback(async (): Promise<void> => {
    if (!rewindTargetUuid) return
    const targetUuid = rewindTargetUuid
    setRewindTargetUuid(null)
    try {
      const result = await window.electronAPI.rewindSession({ sessionId, assistantMessageUuid: targetUuid })
      store.set(agentMessageRefreshAtom, (prev) => { const map = new Map(prev); map.set(sessionId, (prev.get(sessionId) ?? 0) + 1); return map })
      store.set(agentDiffRefreshVersionAtom, (prev) => { const m = new Map(prev); m.set(sessionId, (prev.get(sessionId) ?? 0) + 1); return m })
      if (result.fileRewind?.canRewind) {
        toast.success('已回退到此处', { description: `${result.fileRewind.filesChanged?.length ?? 0} 个文件已恢复` })
      } else if (result.fileRewind?.error) {
        toast.warning('已回退对话', { description: `文件恢复不可用：${result.fileRewind.error}` })
      } else {
        toast.success('已回退到此处')
      }
    } catch (error) {
      console.error('[AgentView] 回退失败:', error)
      toast.error('回退失败', { description: error instanceof Error ? error.message : '未知错误' })
    }
  }, [rewindTargetUuid, sessionId, store])

  return { retry, retryInNewSession, fork, rewindRequest, rewindConfirm, rewindTargetUuid, setRewindTargetUuid, getUserTextFromSDKMessage }
}
