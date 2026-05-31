/**
 * LeftSidebar — 左侧导航栏聚合根
 *
 * 职责：组合 hooks 和视图，不做业务逻辑
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Settings, Plus, Search, PanelLeftClose, Archive, ArchiveRestore, ArrowLeft, Plug, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ModeSwitcher } from './ModeSwitcher'
import { SearchDialog } from './SearchDialog'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { WorkspaceSelector } from '@/components/agent/WorkspaceSelector'
import { MoveSessionDialog } from '@/components/agent/MoveSessionDialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import {
  conversationsAtom, currentConversationIdAtom, streamingConversationIdsAtom,
} from '@/atoms/chat-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { hasUpdateAtom } from '@/atoms/updater'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { workingSessionGroupsAtom, workingSessionIdsSetAtom } from '@/atoms/working-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useConversationActions } from './hooks/useConversationActions'
import { useAgentSessionActions } from './hooks/useAgentSessionActions'
import { useSidebarNavigation } from './hooks/useSidebarNavigation'
import { ConversationListView } from './views/ConversationListView'
import { AgentSessionListView } from './views/AgentSessionListView'
import { SidebarNavigationView, getRailInitial, RAIL_STATUS_CLASS } from './views/SidebarNavigationView'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import type { AgentSessionMeta } from '@proma/shared'
import { detectIsMac } from '@/lib/platform'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'

export interface LeftSidebarProps {
  width?: number
}

function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: '今天' | '昨天' | '更早'; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const today: T[] = []; const yesterday: T[] = []; const earlier: T[] = []
  for (const item of items) {
    if (item.updatedAt >= todayStart) today.push(item)
    else if (item.updatedAt >= yesterdayStart) yesterday.push(item)
    else earlier.push(item)
  }
  const groups: Array<{ label: '今天' | '昨天' | '更早'; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天' as const, items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天' as const, items: yesterday })
  if (earlier.length > 0) groups.push({ label: '更早' as const, items: earlier })
  return groups
}

export function LeftSidebar({ width }: LeftSidebarProps): React.ReactElement {
  const store = useStore()

  // ---- Navigation state ----
  const nav = useSidebarNavigation()
  const openSession = useOpenSession()

  // ---- Conversation actions ----
  const convActions = useConversationActions(openSession)

  // ---- Agent session actions ----
  const agentActions = useAgentSessionActions(openSession)

  // ---- Atoms not encapsulated in hooks ----
  const userProfile = useAtomValue(userProfileAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const mode = useAtomValue(appModeAtom)
  const isMac = React.useMemo(() => detectIsMac(), [])
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)
  // ---- Derived state ----
  const workingGroups = useAtomValue(workingSessionGroupsAtom)
  const workingSessionIds = useAtomValue(workingSessionIdsSetAtom)
  const streamingIds = useAtomValue(streamingConversationIdsAtom)

  // Pinned conversations and agent sessions
  const pinnedConversations = React.useMemo(
    () => convActions.conversations.filter((c) => c.pinned && !c.archived),
    [convActions.conversations],
  )
  const pinnedAgentSessions = React.useMemo(
    () => agentActions.agentSessions.filter((s) => s.pinned && !s.archived),
    [agentActions.agentSessions],
  )
  const hasWorkingSessions = workingGroups.todo.length + workingGroups.running.length + workingGroups.done.length > 0

  // Filtered conversation groups (non-archived, non-draft, non-working)
  const conversationGroups = React.useMemo(
    () => groupByDate(
      convActions.conversations.filter((c) => {
        if (nav.viewMode === 'archived') return c.archived
        return !c.archived && !c.pinned && !draftSessionIds.has(c.id)
      })
    ),
    [convActions.conversations, draftSessionIds, nav.viewMode],
  )

  // Filtered agent session groups
  const filteredAgentSessions = React.useMemo(
    () => agentActions.agentSessions.filter((s) =>
      s.workspaceId === agentActions.currentWorkspaceId
      && !draftSessionIds.has(s.id)
      && (nav.viewMode === 'archived' ? s.archived : !s.archived && !s.pinned && !workingSessionIds.has(s.id))
    ),
    [agentActions.agentSessions, agentActions.currentWorkspaceId, draftSessionIds, nav.viewMode, workingSessionIds],
  )
  const agentSessionGroups = React.useMemo(() => groupByDate(filteredAgentSessions), [filteredAgentSessions])

  // Archived counts
  const archivedConversationCount = React.useMemo(
    () => convActions.conversations.filter((c) => c.archived).length,
    [convActions.conversations],
  )
  const archivedAgentSessionCount = React.useMemo(
    () => agentActions.agentSessions.filter((s) => s.archived).length,
    [agentActions.agentSessions],
  )

  // Workspace name map for cross-workspace display
  const workspaceNameMap = React.useMemo(
    () => new Map(agentActions.workspaces.map((w) => [w.id, w.name])),
    [agentActions.workspaces],
  )

  // Rail recent items (mini sidebar)
  const railRecentItems = React.useMemo(() => {
    if (mode === 'chat') {
      const items = convActions.conversations
        .filter((c) => !c.archived && !draftSessionIds.has(c.id))
        .sort((a, b) => {
          const activeDelta = Number(b.id === nav.activeTabId) - Number(a.id === nav.activeTabId)
          if (activeDelta !== 0) return activeDelta
          const streamingDelta = Number(streamingIds.has(b.id)) - Number(streamingIds.has(a.id))
          if (streamingDelta !== 0) return streamingDelta
          const pinnedDelta = Number(!!b.pinned) - Number(!!a.pinned)
          if (pinnedDelta !== 0) return pinnedDelta
          return b.updatedAt - a.updatedAt
        })
        .slice(0, 5)
        .map((c) => ({
          id: c.id, title: c.title, type: 'chat' as const,
          initial: getRailInitial(c.title), active: c.id === nav.activeTabId,
          status: (streamingIds.has(c.id) ? 'running' : 'idle') as SessionIndicatorStatus,
          pinned: !!c.pinned,
        }))
      return items
    }

    return agentActions.agentSessions
      .filter((s) => !s.archived && !draftSessionIds.has(s.id) && (!agentActions.currentWorkspaceId || s.workspaceId === agentActions.currentWorkspaceId))
      .sort((a, b) => {
        const statusA = agentActions.agentIndicatorMap.get(a.id) ?? (agentActions.unviewedCompletedSessionIds.has(a.id) ? 'completed' : 'idle')
        const statusB = agentActions.agentIndicatorMap.get(b.id) ?? (agentActions.unviewedCompletedSessionIds.has(b.id) ? 'completed' : 'idle')
        const priority = (s: AgentSessionMeta, st: SessionIndicatorStatus): number => {
          if (s.id === nav.activeTabId) return 0
          if (st === 'blocked') return 1
          if (st === 'running') return 2
          if (workingSessionIds.has(s.id)) return 3
          if (s.pinned) return 4
          if (st === 'completed') return 5
          return 6
        }
        const d = priority(a, statusA) - priority(b, statusB)
        if (d !== 0) return d
        return b.updatedAt - a.updatedAt
      })
      .slice(0, 5)
      .map((s) => ({
        id: s.id, title: s.title, type: 'agent' as const,
        initial: getRailInitial(s.title), active: s.id === nav.activeTabId,
        status: agentActions.agentIndicatorMap.get(s.id) ?? (agentActions.unviewedCompletedSessionIds.has(s.id) ? 'completed' : 'idle'),
        pinned: !!s.pinned,
      }))
  }, [mode, convActions.conversations, agentActions.agentSessions, agentActions.agentIndicatorMap,
      agentActions.unviewedCompletedSessionIds, agentActions.currentWorkspaceId,
      draftSessionIds, nav.activeTabId, streamingIds, workingSessionIds])

  // ---- Delete handling ----
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const handleConfirmDelete = React.useCallback(async () => {
    if (!pendingDeleteId) return
    if (mode === 'chat') {
      try {
        await window.electronAPI.deleteConversation(pendingDeleteId)
        store.set(conversationsAtom, (prev) => prev.filter((c) => c.id !== pendingDeleteId))
        if (convActions.currentConversationId === pendingDeleteId) store.set(currentConversationIdAtom, null)
      } catch (error) {
        console.error('[LeftSidebar] 删除对话失败:', error)
        toast.error('删除对话失败')
      }
    } else {
      await agentActions.handleConfirmDelete(pendingDeleteId, agentActions.currentAgentSessionId)
    }
    setPendingDeleteId(null)
  }, [pendingDeleteId, mode, convActions.currentConversationId, agentActions, store])

  const handleRequestDelete = React.useCallback((id: string) => { setPendingDeleteId(id) }, [])

  // ---- Rail mode switch ----
  const handleRailModeSwitch = React.useCallback((targetMode: AppMode) => {
    nav.setViewMode('active')
    if (targetMode === mode) return
    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? convActions.conversations : agentActions.agentSessions
    const lastId = isChatMode ? convActions.currentConversationId : agentActions.currentAgentSessionId
    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) { openSession(targetMode, match.id, match.title); return }
    }
    const recent = sessions.find((s) => !draftSessionIds.has(s.id))
    if (recent) { openSession(targetMode, recent.id, recent.title); return }
    store.set(appModeAtom, targetMode)
  }, [mode, convActions.conversations, convActions.currentConversationId,
      agentActions.agentSessions, agentActions.currentAgentSessionId,
      draftSessionIds, openSession, nav.setViewMode, store])

  // ---- Dialog state ----
  const [moveTargetId, setMoveTargetId] = React.useState<string | null>(null)

  // ---- Render: collapsed rail ----
  if (nav.sidebarCollapsed) {
    return (
      <>
        <SidebarNavigationView
          mode={mode} isMac={isMac} hasUpdate={hasUpdate}
          hasEnvironmentIssues={hasEnvironmentIssues}
          userAvatar={userProfile.avatar}
          railRecentItems={railRecentItems}
          onExpand={() => nav.setSidebarCollapsed(false)}
          onRailModeSwitch={handleRailModeSwitch}
          onNewConversation={convActions.handleNewConversation}
          onNewAgentSession={agentActions.handleNewAgentSession}
          onSearch={() => setSearchDialogOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onSelectAgent={agentActions.handleSelectAgentSession}
          onSelectChat={convActions.handleSelectConversation}
        />
        <SearchDialog />
      </>
    )
  }

  // ---- Render: expanded sidebar ----
  return (
    <div className="relative h-full flex flex-col bg-background rounded-2xl shadow-xl transition-[width] duration-300"
      style={{ width: width ?? 240, minWidth: 170, flexShrink: 1 }}>
      <div aria-hidden="true" className="sidebar-window-drag-strip"
        style={{ height: isMac ? 30 : 4 }} />
      <div className={cn('w-full flex-shrink-0 titlebar-drag-region', isMac ? 'h-[30px]' : 'h-1')} />

      {/* 模式切换器 + 折叠按钮 */}
      <div className="titlebar-drag-region flex items-start gap-1.5 px-3">
        <div className="flex-1 min-w-0"><ModeSwitcher /></div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => nav.setSidebarCollapsed(true)}
              className="mt-2 size-10 flex-shrink-0 flex items-center justify-center rounded-[10px] bg-muted text-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors titlebar-no-drag">
              <PanelLeftClose size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">收起侧边栏 ({isMac ? '⌘B' : 'Ctrl+B'})</TooltipContent>
        </Tooltip>
      </div>

      {/* Agent 模式：工作区选择器 */}
      {mode === 'agent' && <div className="px-3 pt-2"><WorkspaceSelector /></div>}

      {/* 新对话/新会话按钮 + 搜索 */}
      <div className="px-3 pt-2 flex items-center gap-1.5">
        <button onClick={mode === 'agent' ? agentActions.handleNewAgentSession : convActions.handleNewConversation}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-medium text-foreground/70 bg-primary/5 hover:bg-primary/10 transition-colors duration-100 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]">
          <Plus size={14} /><span>{mode === 'agent' ? '新会话' : '新对话'}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => setSearchDialogOpen(true)}
              className="flex-shrink-0 size-[36px] flex items-center justify-center rounded-[10px] text-foreground/40 bg-primary/5 hover:bg-primary/10 hover:text-foreground/60 transition-colors duration-100 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]">
              <Search size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">搜索 ({getAcceleratorDisplay(getActiveAccelerator('global-search'))})</TooltipContent>
        </Tooltip>
      </div>

      {/* Main content area */}
      {mode === 'agent' && nav.viewMode === 'active' ? (
        <AgentSessionListView
          agentSessions={agentActions.agentSessions}
          activeTabId={nav.activeTabId}
          agentIndicatorMap={agentActions.agentIndicatorMap}
          unviewedCompletedSessionIds={agentActions.unviewedCompletedSessionIds}
          pinnedAgentSessions={pinnedAgentSessions}
          agentSessionGroups={agentSessionGroups}
          hasWorkingSessions={hasWorkingSessions}
          workingGroups={workingGroups}
          workingSessionIds={workingSessionIds}
          workspaceNameMap={workspaceNameMap}
          agentSubTab={nav.agentSubTab}
          agentTopHeight={nav.agentTopHeight}
          agentSplitContainerRef={nav.agentSplitContainerRef}
          onSelect={agentActions.handleSelectAgentSession}
          onRequestDelete={handleRequestDelete}
          onRequestMove={(id) => setMoveTargetId(id)}
          onRename={agentActions.handleAgentRename}
          onTogglePin={agentActions.handleTogglePinAgent}
          onToggleManualWorking={agentActions.handleToggleManualWorkingAgent}
          onToggleArchive={agentActions.handleToggleArchiveAgent}
          onSubTabChange={nav.setAgentSubTab}
          onAgentTopResizeStart={nav.handleAgentTopResizeStart}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-none">
          {nav.viewMode === 'archived' && (
            <div className="px-6 pt-3 pb-1">
              <div className="text-[12px] font-medium text-foreground/40">
                已归档{mode === 'agent' ? '会话' : '对话'}
              </div>
            </div>
          )}

          {mode === 'chat' ? (
            <ConversationListView
              conversations={convActions.conversations}
              activeTabId={nav.activeTabId}
              streamingIds={streamingIds}
              pinnedExpanded={nav.pinnedExpanded}
              pinnedConversations={pinnedConversations}
              conversationGroups={conversationGroups}
              onSelect={convActions.handleSelectConversation}
              onRequestDelete={handleRequestDelete}
              onRename={convActions.handleRename}
              onTogglePin={convActions.handleTogglePin}
              onToggleArchive={convActions.handleToggleArchive}
              onTogglePinnedExpanded={() => nav.setPinnedExpanded(!nav.pinnedExpanded)}
            />
          ) : (
            /* Agent 模式归档视图 */
            agentSessionGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((s) => (
                    <div key={s.id} /* AgentSessionItem placeholder - rendered via items */ >
                      {/* Agent session items in archived view - handles natively */}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 已归档入口 / 返回活跃 */}
      <div className="px-3 pb-1">
        {nav.viewMode === 'active' ? (
          <>
            {mode === 'chat' && archivedConversationCount > 0 && (
              <button onClick={() => nav.setViewMode('archived')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag">
                <Archive size={13} className="text-foreground/30" />
                <span>已归档 ({archivedConversationCount})</span>
              </button>
            )}
            {mode === 'agent' && archivedAgentSessionCount > 0 && (
              <button onClick={() => nav.setViewMode('archived')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag">
                <Archive size={13} className="text-foreground/30" />
                <span>已归档 ({archivedAgentSessionCount})</span>
              </button>
            )}
          </>
        ) : (
          <button onClick={() => nav.setViewMode('active')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/60 bg-foreground/[0.04] hover:bg-foreground/[0.07] hover:text-foreground/80 transition-colors titlebar-no-drag">
            <ArrowLeft size={13} className="text-foreground/50" />
            <span>返回活跃{mode === 'agent' ? '会话' : '对话'}</span>
          </button>
        )}
      </div>

      {/* 工作区能力指示器 */}
      {mode === 'agent' && agentActions.capabilities && (
        <div className="px-3 pb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => { setSettingsTab('agent'); setSettingsOpen(true) }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-[12px] text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/70 transition-colors titlebar-no-drag">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span className="flex items-center gap-1">
                    <Plug size={13} className="text-foreground/40" />
                    <span className="tabular-nums">{agentActions.capabilities.mcpServers.filter((s) => s.enabled).length}</span>
                    <span className="text-foreground/30">MCP</span>
                  </span>
                  <span className="text-foreground/20">·</span>
                  <span className="flex items-center gap-1">
                    <Zap size={13} className="text-foreground/40" />
                    <span className="tabular-nums">{agentActions.capabilities.skills.length}</span>
                    <span className="text-foreground/30">Skills</span>
                  </span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">点击配置 MCP 与 Skills</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* 底部：用户资料 */}
      <div className="px-3 pb-3">
        <button onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors titlebar-no-drag text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground">
          <UserAvatar avatar={userProfile.avatar} size={28} />
          <span className="flex-1 text-sm truncate text-left">{userProfile.userName}</span>
          <div className="relative flex-shrink-0 text-foreground/40">
            <Settings size={16} />
            {(hasUpdate || hasEnvironmentIssues) && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </div>
        </button>
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}>
        <AlertDialogContent onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmDelete() } }}>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除对话</AlertDialogTitle>
            <AlertDialogDescription>删除后将无法恢复，确定要删除这个对话吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 迁移对话框 */}
      <MoveSessionDialog
        open={moveTargetId !== null}
        onOpenChange={(open) => { if (!open) setMoveTargetId(null) }}
        sessionId={moveTargetId ?? ''}
        currentWorkspaceId={agentActions.currentWorkspaceId ?? undefined}
        workspaces={agentActions.workspaces}
        onMoved={() => setMoveTargetId(null)}
      />

      <SearchDialog />
    </div>
  )
}
