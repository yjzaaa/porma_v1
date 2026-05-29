import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { activeViewAtom } from '@/atoms/active-view'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { sidebarViewModeAtom, agentSidebarTopHeightAtom } from '@/atoms/sidebar-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
import { conversationsAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import type { AgentSessionMeta, ConversationMeta } from '@proma/shared'

export interface SidebarNavigationResult {
  mode: AppMode
  activeView: import('@/atoms/active-view').ActiveView
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  viewMode: 'active' | 'archived'
  setViewMode: (mode: 'active' | 'archived') => void
  searchDialogOpen: boolean
  setSearchDialogOpen: (open: boolean) => void
  tabs: import('@/atoms/tab-atoms').TabItem[]
  activeTabId: string | null
  pinnedExpanded: boolean
  setPinnedExpanded: (expanded: boolean) => void
  agentSubTab: 'working' | 'pinned'
  setAgentSubTab: (tab: 'working' | 'pinned') => void
  agentTopHeight: number
  agentSplitContainerRef: React.RefObject<HTMLDivElement | null>
  agentTopResizing: React.MutableRefObject<boolean>
  agentTopResizeCleanup: React.MutableRefObject<(() => void) | null>
  isMac: boolean
  openSession: (mode: 'chat' | 'agent', sessionId: string, title: string) => void
  handleItemClick: (item: 'pinned' | 'all-chats') => void
  handleRailModeSwitch: (targetMode: AppMode) => void
  handleAgentTopResizeStart: (e: React.MouseEvent) => void
}

const AGENT_TOP_MIN_HEIGHT = 80
const AGENT_TOP_MAX_RATIO = 0.7

function computeAgentTopMaxHeight(containerHeight: number): number {
  return Math.max(AGENT_TOP_MIN_HEIGHT, Math.floor(containerHeight * AGENT_TOP_MAX_RATIO))
}

export function useSidebarNavigation(): SidebarNavigationResult {
  const mode = useAtomValue(appModeAtom)
  const activeView = useAtomValue(activeViewAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const [viewMode, setViewMode] = useAtom(sidebarViewModeAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)

  const [tabs] = useAtom(tabsAtom)
  const [activeTabId] = useAtom(activeTabIdAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)

  const setMode = useSetAtom(appModeAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()

  const isMac = React.useMemo(() => {
    return typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  }, [])

  const [pinnedExpanded, setPinnedExpanded] = React.useState(true)
  const [agentSubTab, setAgentSubTab] = React.useState<'working' | 'pinned'>('working')

  const [agentTopHeight, setAgentTopHeight] = useAtom(agentSidebarTopHeightAtom)
  const agentSplitContainerRef = React.useRef<HTMLDivElement>(null)
  const agentTopResizing = React.useRef(false)
  const agentTopResizeCleanup = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    return () => { agentTopResizeCleanup.current?.() }
  }, [])

  React.useEffect(() => {
    if (agentTopHeight > 0) return
    const el = agentSplitContainerRef.current
    if (!el) return
    const h = el.getBoundingClientRect().height
    if (h > 0) setAgentTopHeight(Math.round(h * 0.4))
  }, [agentTopHeight, setAgentTopHeight, mode, viewMode])

  React.useEffect(() => {
    const el = agentSplitContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      if (agentTopResizing.current) return
      const entry = entries[0]
      if (!entry) return
      const containerHeight = entry.contentRect.height
      if (containerHeight <= 0) return
      const maxH = computeAgentTopMaxHeight(containerHeight)
      setAgentTopHeight((prev) => {
        if (prev <= 0) return prev
        return prev <= maxH ? prev : maxH
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [setAgentTopHeight, mode, viewMode])

  const handleAgentTopResizeStart = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = agentSplitContainerRef.current
      if (!container) return
      agentTopResizing.current = true
      const startY = e.clientY
      const startH = Math.max(0, agentTopHeight)
      const containerHeight = container.getBoundingClientRect().height
      const minH = AGENT_TOP_MIN_HEIGHT
      const maxH = computeAgentTopMaxHeight(containerHeight)

      const onMove = (ev: MouseEvent): void => {
        if (!agentTopResizing.current) return
        const delta = ev.clientY - startY
        const next = Math.min(maxH, Math.max(minH, startH + delta))
        setAgentTopHeight(next)
      }

      const onUp = (): void => {
        agentTopResizing.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        agentTopResizeCleanup.current = null
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      agentTopResizeCleanup.current = onUp
    },
    [agentTopHeight, setAgentTopHeight],
  )

  const handleItemClick = React.useCallback((item: 'pinned' | 'all-chats'): void => {
    if (item === 'pinned') setPinnedExpanded((prev) => !prev)
  }, [])

  const handleRailModeSwitch = React.useCallback((targetMode: AppMode) => {
    setViewMode('active')
    if (targetMode === mode) return

    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? conversations : (agentSessions as unknown as Array<{ id: string; title: string }>)
    const lastId = isChatMode
      ? (activeView === 'conversations' ? activeTabId : null)
      : activeTabId

    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) {
        openSession(targetMode, match.id, match.title)
        return
      }
    }

    const recent = sessions.find((s) => !draftSessionIds.has(s.id))
    if (recent) {
      openSession(targetMode, recent.id, recent.title)
      return
    }

    setMode(targetMode)
  }, [mode, conversations, agentSessions, activeTabId, draftSessionIds, openSession, setMode, setViewMode])

  return {
    mode, activeView, sidebarCollapsed, setSidebarCollapsed,
    viewMode, setViewMode, searchDialogOpen: false, setSearchDialogOpen,
    tabs, activeTabId,
    pinnedExpanded, setPinnedExpanded, agentSubTab, setAgentSubTab,
    agentTopHeight, agentSplitContainerRef, agentTopResizing, agentTopResizeCleanup, isMac,
    openSession,
    handleItemClick, handleRailModeSwitch, handleAgentTopResizeStart,
  }
}
