import * as React from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  agentStreamingStatesAtom,
  agentSessionStreamingStateAtomFamily,
  liveMessagesMapAtom,
  agentMessageRefreshAtom,
  stoppedByUserSessionsAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentSessionsAtom,
  agentSessionPathMapAtom,
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  workspaceAttachedFilesMapAtom,
} from '@/atoms/agent-atoms'
import { sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import type { SDKMessage } from '@proma/shared'

const EMPTY_SDK_MESSAGES: SDKMessage[] = []

export interface AgentSessionLoadResult {
  persistedSDKMessages: SDKMessage[]
  setPersistedSDKMessages: React.Dispatch<React.SetStateAction<SDKMessage[]>>
  messagesLoaded: boolean
  refreshVersion: number
  liveMessages: SDKMessage[]
  streaming: boolean
  stoppedByUser: boolean
  sendWithCmdEnter: boolean
  currentWorkspaceId: string | null
  workspaceSlug: string | null
  sessions: import('@proma/shared').AgentSessionMeta[]
  workspaces: import('@proma/shared').AgentWorkspace[]
  sessionPath: string | null
  streamState: ReturnType<typeof useAtomValue<ReturnType<typeof agentSessionStreamingStateAtomFamily>>>
}

export function useAgentSessionLoad(sessionId: string): AgentSessionLoadResult {
  const [persistedSDKMessages, setPersistedSDKMessages] = React.useState<SDKMessage[]>([])
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const streaming = streamState?.running ?? false
  const stoppedByUserSessions = useAtomValue(stoppedByUserSessionsAtom)
  const sendWithCmdEnter = useAtomValue(sendWithCmdEnterAtom)
  const stoppedByUser = stoppedByUserSessions.has(sessionId)
  const liveMessagesMap = useAtomValue(liveMessagesMapAtom)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  const liveMessages = liveMessagesMap.get(sessionId) ?? EMPTY_SDK_MESSAGES
  const globalWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const currentWorkspaceId = React.useMemo(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    if (!meta) return globalWorkspaceId
    return meta.workspaceId ?? null
  }, [sessions, sessionId, globalWorkspaceId])
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0
  const [messagesLoaded, setMessagesLoaded] = React.useState(false)
  const loadingSessionIdRef = React.useRef<string | null>(null)
  const store = useStore()
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const setSessionPathMap = useSetAtom(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const setAttachedFilesMap = useSetAtom(agentAttachedFilesMapAtom)
  const setWsAttachedFilesMap = useSetAtom(workspaceAttachedFilesMapAtom)

  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)

  // 加载当前会话消息
  React.useEffect(() => {
    if (loadingSessionIdRef.current !== sessionId) {
      loadingSessionIdRef.current = sessionId
      setPersistedSDKMessages([])
      setMessagesLoaded(false)
    }
    let cancelled = false
    window.electronAPI.getAgentSessionSDKMessages(sessionId)
      .then((sdkMsgs) => {
        if (cancelled) return
        unstable_batchedUpdates(() => {
          setPersistedSDKMessages(sdkMsgs)
          setMessagesLoaded(true)

          setStreamingStates((prev) => {
            const state = prev.get(sessionId)
            if (!state || state.running) return prev
            const map = new Map(prev)
            if (state.inputTokens !== undefined) {
              map.set(sessionId, {
                running: false,
                content: '',
                toolActivities: [],
                inputTokens: state.inputTokens,
                outputTokens: state.outputTokens,
                cacheReadTokens: state.cacheReadTokens,
                cacheCreationTokens: state.cacheCreationTokens,
                contextWindow: state.contextWindow,
                model: state.model,
              })
            } else {
              map.delete(sessionId)
            }
            return map
          })
          setLiveMessagesMap((prev) => {
            if (!prev.has(sessionId)) return prev
            const streamingState = store.get(agentStreamingStatesAtom).get(sessionId)
            if (streamingState?.running) return prev
            const map = new Map(prev)
            map.delete(sessionId)
            return map
          })
        })
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [sessionId, refreshVersion, setStreamingStates, setLiveMessagesMap, store])

  // 获取 session 路径
  React.useEffect(() => {
    if (!currentWorkspaceId) {
      setSessionPathMap((prev) => {
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      return
    }

    window.electronAPI
      .getAgentSessionPath(currentWorkspaceId, sessionId)
      .then((path) => {
        if (path) {
          setSessionPathMap((prev) => {
            const map = new Map(prev)
            map.set(sessionId, path)
            return map
          })
        } else {
          setSessionPathMap((prev) => {
            const map = new Map(prev)
            map.delete(sessionId)
            return map
          })
        }
      })
      .catch(() => {
        setSessionPathMap((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
  }, [sessionId, currentWorkspaceId, setSessionPathMap])

  // 获取工作区文件路径
  React.useEffect(() => {
    if (!workspaceSlug) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI
      .getWorkspaceFilesPath(workspaceSlug)
      .then(setWorkspaceFilesPath)
      .catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  // 获取工作区附加文件
  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI
      .getWorkspaceAttachedFiles(workspaceSlug)
      .then((files) => {
        setWsAttachedFilesMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, files)
          return map
        })
      })
      .catch(console.error)
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedFilesMap])

  // 从会话元数据初始化附加目录（水合）
  React.useEffect(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    const dirs = meta?.attachedDirectories ?? []
    setAttachedDirsMap((prev) => {
      const existing = prev.get(sessionId)
      if (existing != null) return prev
      const map = new Map(prev)
      if (dirs.length > 0) {
        map.set(sessionId, dirs)
      }
      return map
    })
  }, [sessionId, sessions, setAttachedDirsMap])

  // 从会话元数据初始化附加文件（水合）
  React.useEffect(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    const files = meta?.attachedFiles ?? []
    setAttachedFilesMap((prev) => {
      const existing = prev.get(sessionId)
      if (existing != null) return prev
      const map = new Map(prev)
      if (files.length > 0) {
        map.set(sessionId, files)
      }
      return map
    })
  }, [sessionId, sessions, setAttachedFilesMap])

  return {
    persistedSDKMessages,
    setPersistedSDKMessages,
    messagesLoaded,
    refreshVersion,
    liveMessages,
    streaming,
    stoppedByUser,
    sendWithCmdEnter,
    currentWorkspaceId,
    workspaceSlug,
    sessions,
    workspaces,
    sessionPath,
    streamState,
  }
}
