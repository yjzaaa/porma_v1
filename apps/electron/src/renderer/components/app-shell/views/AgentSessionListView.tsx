import * as React from 'react'
import { cn } from '@/lib/utils'
import { AgentSessionItem } from '../items/AgentSessionItem'
import type { AgentSessionMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

type DateGroup = '今天' | '昨天' | '更早'

function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const today: T[] = []; const yesterday: T[] = []; const earlier: T[] = []
  for (const item of items) {
    if (item.updatedAt >= todayStart) today.push(item)
    else if (item.updatedAt >= yesterdayStart) yesterday.push(item)
    else earlier.push(item)
  }
  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天', items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', items: yesterday })
  if (earlier.length > 0) groups.push({ label: '更早', items: earlier })
  return groups
}

export interface AgentSessionListViewProps {
  agentSessions: AgentSessionMeta[]
  activeTabId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  unviewedCompletedSessionIds: Set<string>
  pinnedAgentSessions: AgentSessionMeta[]
  agentSessionGroups: Array<{ label: DateGroup; items: AgentSessionMeta[] }>
  hasWorkingSessions: boolean
  workingGroups: { todo: AgentSessionMeta[]; running: AgentSessionMeta[]; done: AgentSessionMeta[] }
  workingSessionIds: Set<string>
  workspaceNameMap: Map<string, string>
  agentSubTab: 'working' | 'pinned'
  agentTopHeight: number
  agentSplitContainerRef: React.RefObject<HTMLDivElement | null>
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleManualWorking: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onSubTabChange: (tab: 'working' | 'pinned') => void
  onAgentTopResizeStart: (e: React.MouseEvent) => void
}

export function AgentSessionListView({
  agentSessions, activeTabId, agentIndicatorMap, unviewedCompletedSessionIds,
  pinnedAgentSessions, agentSessionGroups, hasWorkingSessions, workingGroups,
  workingSessionIds, workspaceNameMap, agentSubTab, agentTopHeight,
  agentSplitContainerRef,
  onSelect, onRequestDelete, onRequestMove, onRename,
  onTogglePin, onToggleManualWorking, onToggleArchive,
  onSubTabChange, onAgentTopResizeStart,
}: AgentSessionListViewProps): React.ReactElement {
  const hasPinnedOrWorking = pinnedAgentSessions.length > 0 || hasWorkingSessions

  return (
    <div ref={agentSplitContainerRef as React.RefObject<HTMLDivElement>} className="flex-1 flex flex-col min-h-0">
      {hasPinnedOrWorking && (
        <>
          {/* 上区：工作中/置顶 Tab */}
          <div
            style={{ height: agentTopHeight > 0 ? agentTopHeight : undefined }}
            className="flex flex-col min-h-0 flex-shrink-0 overflow-hidden"
          >
            <div className="pt-2 px-3 flex-shrink-0">
              <div className="flex items-center gap-1 mb-0.5">
                <button
                  onClick={() => onSubTabChange('working')}
                  className={cn(
                    'flex-1 justify-center px-2.5 py-0.5 rounded-md text-[12px] font-medium transition-colors titlebar-no-drag inline-flex items-center',
                    agentSubTab === 'working'
                      ? 'tab-item-selected bg-foreground/[0.08] text-foreground/80'
                      : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.04]',
                  )}
                >
                  工作中
                  {hasWorkingSessions && (
                    <span className={cn(
                      'ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px]',
                      agentSubTab === 'working'
                        ? 'bg-foreground/10 text-foreground/60'
                        : 'bg-foreground/10 text-foreground/50',
                    )}>
                      {workingGroups.todo.length + workingGroups.running.length + workingGroups.done.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onSubTabChange('pinned')}
                  className={cn(
                    'flex-1 justify-center px-2.5 py-0.5 rounded-md text-[12px] font-medium transition-colors titlebar-no-drag inline-flex items-center',
                    agentSubTab === 'pinned'
                      ? 'tab-item-selected bg-foreground/[0.08] text-foreground/80'
                      : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.04]',
                  )}
                >
                  置顶
                  {pinnedAgentSessions.length > 0 && (
                    <span className={cn(
                      'ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px]',
                      agentSubTab === 'pinned'
                        ? 'bg-foreground/10 text-foreground/60'
                        : 'bg-foreground/10 text-foreground/50',
                    )}>
                      {pinnedAgentSessions.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-none px-3 pb-1 min-h-0">
              {agentSubTab === 'working' && (
                <div className="pt-0.5 pb-0.5">
                  {hasWorkingSessions ? (
                    <div className="flex flex-col gap-0.5">
                      {workingGroups.todo.map((s) => (
                        <AgentSessionItem key={`working-todo-${s.id}`}
                          session={s} active={s.id === activeTabId}
                          indicatorStatus={agentIndicatorMap.get(s.id) ?? 'idle'}
                          isInWorkingSection leftAccent="orange"
                          workspaceName={workspaceNameMap.get(s.workspaceId ?? '')}
                          onSelect={onSelect} onRequestDelete={onRequestDelete}
                          onRequestMove={onRequestMove} onRename={onRename}
                          onTogglePin={onTogglePin}
                          onToggleManualWorking={onToggleManualWorking}
                          onToggleArchive={onToggleArchive} />
                      ))}
                      {workingGroups.running.map((s) => (
                        <AgentSessionItem key={`working-running-${s.id}`}
                          session={s} active={s.id === activeTabId}
                          indicatorStatus={agentIndicatorMap.get(s.id) ?? 'idle'}
                          isInWorkingSection leftAccent="blue"
                          workspaceName={workspaceNameMap.get(s.workspaceId ?? '')}
                          onSelect={onSelect} onRequestDelete={onRequestDelete}
                          onRequestMove={onRequestMove} onRename={onRename}
                          onTogglePin={onTogglePin}
                          onToggleManualWorking={onToggleManualWorking}
                          onToggleArchive={onToggleArchive} />
                      ))}
                      {workingGroups.done.map((s) => (
                        <AgentSessionItem key={`working-done-${s.id}`}
                          session={s} active={s.id === activeTabId}
                          indicatorStatus={agentIndicatorMap.get(s.id) ?? 'idle'}
                          isInWorkingSection
                          leftAccent={unviewedCompletedSessionIds.has(s.id) ? 'green' : undefined}
                          workspaceName={workspaceNameMap.get(s.workspaceId ?? '')}
                          onSelect={onSelect} onRequestDelete={onRequestDelete}
                          onRequestMove={onRequestMove} onRename={onRename}
                          onTogglePin={onTogglePin}
                          onToggleManualWorking={onToggleManualWorking}
                          onToggleArchive={onToggleArchive} />
                      ))}
                    </div>
                  ) : (
                    <div className="px-2 py-3 text-[11px] text-foreground/30 text-center select-none">
                      暂无进行中的会话
                    </div>
                  )}
                </div>
              )}

              {agentSubTab === 'pinned' && (
                <div className="pt-0.5 pb-0.5">
                  {pinnedAgentSessions.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {pinnedAgentSessions.map((s) => (
                        <AgentSessionItem key={`pinned-${s.id}`}
                          session={s} active={s.id === activeTabId}
                          indicatorStatus={agentIndicatorMap.get(s.id) ?? 'idle'}
                          isInWorkingSection={workingSessionIds.has(s.id)}
                          workspaceName={workspaceNameMap.get(s.workspaceId ?? '')}
                          onSelect={onSelect} onRequestDelete={onRequestDelete}
                          onRequestMove={onRequestMove} onRename={onRename}
                          onTogglePin={onTogglePin}
                          onToggleManualWorking={onToggleManualWorking}
                          onToggleArchive={onToggleArchive} />
                      ))}
                    </div>
                  ) : (
                    <div className="px-2 py-3 text-[11px] text-foreground/30 text-center select-none">
                      暂无置顶会话
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 拖拽分割条 */}
          <div
            onMouseDown={onAgentTopResizeStart}
            className="h-[8px] cursor-row-resize active:bg-primary/50 transition-colors titlebar-no-drag flex-shrink-0 flex items-center"
          >
            <div className="mx-3 w-full border-t border-muted-foreground/20" />
          </div>
        </>
      )}

      {/* 下区：最近会话历史 */}
      <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none flex-shrink-0">
        最近会话
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-none min-h-0">
        {agentSessionGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((s) => (
                <AgentSessionItem key={s.id}
                  session={s} active={s.id === activeTabId}
                  indicatorStatus={agentIndicatorMap.get(s.id) ?? 'idle'}
                  isInWorkingSection={workingSessionIds.has(s.id)}
                  showPinIcon={!!s.pinned}
                  workspaceName={workspaceNameMap.get(s.workspaceId ?? '')}
                  onSelect={onSelect} onRequestDelete={onRequestDelete}
                  onRequestMove={onRequestMove} onRename={onRename}
                  onTogglePin={onTogglePin}
                  onToggleManualWorking={onToggleManualWorking}
                  onToggleArchive={onToggleArchive} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
