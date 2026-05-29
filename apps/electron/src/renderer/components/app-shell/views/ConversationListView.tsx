import * as React from 'react'
import { cn } from '@/lib/utils'
import { ConversationItem } from '../items/ConversationItem'
import type { ConversationMeta } from '@proma/shared'

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

export interface ConversationListViewProps {
  conversations: ConversationMeta[]
  activeTabId: string | null
  streamingIds: Set<string>
  pinnedExpanded: boolean
  pinnedConversations: ConversationMeta[]
  conversationGroups: Array<{ label: DateGroup; items: ConversationMeta[] }>
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onTogglePinnedExpanded: () => void
}

export function ConversationListView({
  conversations, activeTabId, streamingIds,
  pinnedExpanded, pinnedConversations, conversationGroups,
  onSelect, onRequestDelete, onRename, onTogglePin, onToggleArchive,
  onTogglePinnedExpanded,
}: ConversationListViewProps): React.ReactElement {
  return (
    <>
      {/* 置顶导航 */}
      <div className="flex flex-col gap-1 pt-3 px-3">
        <button
          onClick={onTogglePinnedExpanded}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-[7px] rounded-md text-[13px] transition-colors duration-100 titlebar-no-drag text-left',
          )}
        >
          <div className="flex items-center gap-3 flex-1">
            <span className="flex-shrink-0 w-[18px] h-[18px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            </span>
            <span className="text-foreground/60">置顶对话</span>
          </div>
          {pinnedConversations.length > 0 && (
            pinnedExpanded
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/40"><polyline points="6 9 12 15 18 9"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/40"><polyline points="9 18 15 12 9 6"/></svg>
          )}
        </button>
      </div>

      {/* 置顶对话列表 */}
      {pinnedExpanded && pinnedConversations.length > 0 && (
        <div className="px-3 pt-1 pb-1">
          <div className="flex flex-col gap-0.5 pl-1 border-l-2 border-primary/20 ml-2">
            {pinnedConversations.map((conv) => (
              <ConversationItem
                key={`pinned-${conv.id}`}
                conversation={conv}
                active={conv.id === activeTabId}
                streaming={streamingIds.has(conv.id)}
                showPinIcon={false}
                onSelect={onSelect}
                onRequestDelete={onRequestDelete}
                onRename={onRename}
                onTogglePin={onTogglePin}
                onToggleArchive={onToggleArchive}
              />
            ))}
          </div>
        </div>
      )}

      {/* 主对话列表（按日期分组） */}
      {conversationGroups.map((group) => (
        <div key={group.label} className="mb-1">
          <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                active={conv.id === activeTabId}
                streaming={streamingIds.has(conv.id)}
                showPinIcon={!!conv.pinned}
                onSelect={onSelect}
                onRequestDelete={onRequestDelete}
                onRename={onRename}
                onTogglePin={onTogglePin}
                onToggleArchive={onToggleArchive}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
