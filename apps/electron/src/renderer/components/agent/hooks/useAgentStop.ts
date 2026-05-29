import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  agentStreamingStatesAtom,
  agentSessionStreamingStateAtomFamily,
  liveMessagesMapAtom,
  agentStreamErrorsAtom,
  finalizeStreamingActivities,
} from '@/atoms/agent-atoms'
import { agentChannelIdAtom } from '@/atoms/agent-atoms'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'

export interface AgentStopResult {
  stop: () => void
  compact: (agentModelId?: string) => void
  error: string | null
  clearError: () => void
  copyError: () => Promise<void>
  errorCopied: boolean
  agentError: string | null
}

export function useAgentStop(sessionId: string): AgentStopResult {
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const streaming = streamState?.running ?? false
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const streamErrors = useAtomValue(agentStreamErrorsAtom)
  const agentError = streamErrors.get(sessionId) ?? null
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const store = useStore()
  const [errorCopied, setErrorCopied] = React.useState(false)

  const stop = React.useCallback((): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
        ...finalizeStreamingActivities(current.toolActivities),
      })
      return map
    })

    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }, [sessionId, setStreamingStates])

  const compact = React.useCallback((agentModelId?: string): void => {
    if (!agentChannelId || streaming) return

    const streamStartedAt = Date.now()
    const localUuid = crypto.randomUUID()

    const syntheticMsg = {
      type: 'user' as const,
      uuid: localUuid,
      message: {
        content: [{ type: 'text' as const, text: '/compact' }],
      },
      parent_tool_use_id: null,
      _createdAt: streamStartedAt,
    }

    store.set(liveMessagesMapAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? []
      map.set(sessionId, [...current, syntheticMsg])
      return map
    })

    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(sessionId) ?? {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
      }
      map.set(sessionId, { ...current, running: true, startedAt: streamStartedAt, isCompacting: true, compactInFlight: true })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      userMessage: '/compact',
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
    }).catch((error) => {
      console.error('[AgentView] /compact 发送失败:', error)
      store.set(liveMessagesMapAtom, (prev) => {
        const map = new Map(prev)
        const current = (map.get(sessionId) ?? []).filter(
          (m) => (m as unknown as { uuid?: string }).uuid !== localUuid,
        )
        map.set(sessionId, current)
        return map
      })
      setStreamingStates((prev) => {
        const map = new Map(prev)
        const current = prev.get(sessionId)
        if (!current) return prev
        map.set(sessionId, { ...current, isCompacting: false, compactInFlight: false })
        return map
      })
    })
  }, [sessionId, agentChannelId, currentWorkspaceId, streaming, setStreamingStates, store])

  const clearError = React.useCallback((): void => {
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
  }, [sessionId, setAgentStreamErrors])

  const copyError = React.useCallback(async (): Promise<void> => {
    if (!agentError) return
    try {
      await navigator.clipboard.writeText(agentError)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), 2000)
    } catch (error) {
      console.error('[AgentView] 复制错误信息失败:', error)
    }
  }, [agentError])

  return { stop, compact, error: agentError, clearError, copyError, errorCopied, agentError }
}
