import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentSessionIndicatorMapAtom,
  unviewedCompletedSessionIdsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceCapabilitiesVersionAtom,
  type SessionIndicatorStatus,
} from '@/atoms/agent-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { closeTab, tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
import { workingSessionIdsSetAtom } from '@/atoms/working-atoms'
import { sidebarViewModeAtom } from '@/atoms/sidebar-atoms'
import type { AgentSessionMeta, WorkspaceCapabilities } from '@proma/shared'
import { clearPreviewCacheForSession } from '@/components/diff/DiffTabContent'

export interface AgentSessionActionsResult {
  agentSessions: AgentSessionMeta[]
  currentAgentSessionId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  unviewedCompletedSessionIds: Set<string>
  agentChannelId: string | null
  agentModelId: string | null
  currentWorkspaceId: string | null
  workspaces: import('@proma/shared').AgentWorkspace[]
  capabilities: WorkspaceCapabilities | null
  viewMode: 'active' | 'archived'
  moveTargetId: string | null
  setMoveTargetId: (id: string | null) => void
  handleNewAgentSession: () => Promise<void>
  handleSelectAgentSession: (id: string, title?: string) => void
  handleConfirmDelete: (deleteId: string, currentId: string | null) => Promise<void>
  handleAgentRename: (id: string, newTitle: string) => Promise<void>
  handleTogglePinAgent: (id: string) => Promise<void>
  handleToggleArchiveAgent: (id: string) => Promise<void>
  handleToggleManualWorkingAgent: (id: string) => Promise<void>
  handleRequestMove: (id: string) => void
  handleSessionMoved: () => void
}

export function useAgentSessionActions(
  onOpenSession: (mode: 'chat' | 'agent', sessionId: string, title: string) => void,
): AgentSessionActionsResult {
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const [currentAgentSessionId, setCurrentAgentSessionId] = useAtom(currentAgentSessionIdAtom)
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const unviewedCompletedSessionIds = useAtomValue(unviewedCompletedSessionIdsAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const workingSessionIds = useAtomValue(workingSessionIdsSetAtom)

  const [tabs, setTabs] = useAtom(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const [moveTargetId, setMoveTargetId] = React.useState<string | null>(null)
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)

  React.useEffect(() => {
    if (!currentWorkspaceId) { setCapabilities(null); return }
    window.electronAPI.getWorkspaceCapabilities(currentWorkspaceId)
      .then(setCapabilities)
      .catch(() => setCapabilities(null))
  }, [currentWorkspaceId, capabilitiesVersion])

  const viewMode = useAtomValue(sidebarViewModeAtom)

  const handleNewAgentSession = React.useCallback(async (): Promise<void> => {
    if (!currentWorkspaceId && workspaces.length > 0) {
      toast.warning('请先选择工作区')
      return
    }
    try {
      const created = await window.electronAPI.createAgentSession(
        undefined, agentChannelId ?? undefined, currentWorkspaceId ?? undefined,
      )
      setAgentSessions((prev) => [created, ...prev])
      setDraftSessionIds((prev) => { const next = new Set(prev); next.add(created.id); return next })
      if (currentWorkspaceId) {
        setSessionChannelMap((prev) => { const map = new Map(prev); map.set(created.id, agentChannelId ?? ''); return map })
        setSessionModelMap((prev) => { const map = new Map(prev); map.set(created.id, agentModelId ?? ''); return map })
      }
      setCurrentAgentSessionId(created.id)
      onOpenSession('agent', created.id, created.title)
    } catch (error) {
      console.error('[LeftSidebar] 创建 Agent 会话失败:', error)
      toast.error('创建 Agent 会话失败')
    }
  }, [currentWorkspaceId, workspaces, agentChannelId, agentModelId, setAgentSessions, setDraftSessionIds,
      setSessionChannelMap, setSessionModelMap, setCurrentAgentSessionId, onOpenSession])

  const handleSelectAgentSession = React.useCallback((id: string, title?: string): void => {
    setCurrentAgentSessionId(id)
    setUnviewedCompleted((prev) => { const next = new Set(prev); next.delete(id); return next })
    const tabTitle = title ?? agentSessions.find((s) => s.id === id)?.title ?? 'Agent 会话'
    onOpenSession('agent', id, tabTitle)
  }, [setCurrentAgentSessionId, setUnviewedCompleted, agentSessions, onOpenSession])

  const handleConfirmDelete = React.useCallback(async (deleteId: string, currentId: string | null): Promise<void> => {
    try {
      await window.electronAPI.deleteAgentSession(deleteId)
      setAgentSessions((prev) => prev.filter((s) => s.id !== deleteId))
      if (currentId === deleteId) setCurrentAgentSessionId(null)
      const result = closeTab(tabs, activeTabId, deleteId); setTabs(result.tabs)
      clearPreviewCacheForSession(deleteId)
    } catch (error) {
      console.error('[LeftSidebar] 删除 Agent 会话失败:', error)
      toast.error('删除 Agent 会话失败')
    }
  }, [setAgentSessions, setCurrentAgentSessionId])

  const handleAgentRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
    try {
      await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: newTitle } : s))
    } catch (error) {
      console.error('[LeftSidebar] 重命名失败:', error)
      toast.error('重命名失败')
    }
  }, [setAgentSessions])

  const handleTogglePinAgent = React.useCallback(async (id: string): Promise<void> => {
    try {
      await window.electronAPI.togglePinAgentSession(id)
      setAgentSessions((prev) => prev.map((s) => s.id === id ? { ...s, pinned: !s.pinned } : s))
    } catch (error) {
      console.error('[LeftSidebar] 置顶切换失败:', error)
      toast.error('置顶切换失败')
    }
  }, [setAgentSessions])

  const handleToggleArchiveAgent = React.useCallback(async (id: string): Promise<void> => {
    try {
      await window.electronAPI.toggleArchiveAgentSession(id)
      setAgentSessions((prev) => prev.map((s) => s.id === id ? { ...s, archived: !s.archived } : s))
    } catch (error) {
      console.error('[LeftSidebar] 归档切换失败:', error)
      toast.error('归档切换失败')
    }
  }, [setAgentSessions])

  const handleToggleManualWorkingAgent = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleManualWorkingAgentSession(id)
      setAgentSessions((prev) => prev.map((s) => s.id === id ? { ...s, manualWorking: updated.manualWorking } : s))
    } catch (error) {
      console.error('[LeftSidebar] 工作中切换失败:', error)
      toast.error('工作中切换失败')
    }
  }, [setAgentSessions])

  const handleRequestMove = React.useCallback((id: string): void => { setMoveTargetId(id) }, [])
  const handleSessionMoved = React.useCallback((): void => { setMoveTargetId(null) }, [])

  return {
    agentSessions, currentAgentSessionId, agentIndicatorMap, unviewedCompletedSessionIds,
    agentChannelId, agentModelId, currentWorkspaceId, workspaces, capabilities, viewMode,
    moveTargetId, setMoveTargetId,
    handleNewAgentSession, handleSelectAgentSession, handleConfirmDelete,
    handleAgentRename, handleTogglePinAgent, handleToggleArchiveAgent,
    handleToggleManualWorkingAgent, handleRequestMove, handleSessionMoved,
  }
}
