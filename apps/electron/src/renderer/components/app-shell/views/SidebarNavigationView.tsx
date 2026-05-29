import * as React from 'react'
import { Bot, MessageSquare, Plus, Search, PanelLeftOpen, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CollapsedWorkspacePopover } from '@/components/agent/CollapsedWorkspacePopover'
import { UserAvatar } from '@/components/chat/UserAvatar'
import type { AppMode } from '@/atoms/app-mode'

type SessionIndicatorStatus = 'idle' | 'running' | 'blocked' | 'completed'

const RAIL_STATUS_CLASS: Record<SessionIndicatorStatus, string> = {
  idle: 'hidden',
  running: 'bg-blue-500 animate-pulse',
  blocked: 'bg-orange-500',
  completed: 'bg-emerald-500',
}

interface RailItem {
  id: string
  title: string
  type: 'chat' | 'agent'
  initial: string
  active: boolean
  status: SessionIndicatorStatus
  pinned: boolean
}

interface SidebarNavigationViewProps {
  mode: AppMode
  isMac: boolean
  hasUpdate: boolean
  hasEnvironmentIssues: boolean
  userAvatar: string
  railRecentItems: RailItem[]
  onExpand: () => void
  onRailModeSwitch: (targetMode: AppMode) => void
  onNewConversation: () => void
  onNewAgentSession: () => void
  onSearch: () => void
  onSettings: () => void
  onSelectAgent: (id: string, title: string) => void
  onSelectChat: (id: string, title: string) => void
}

const SIDEBAR_DRAG_STRIP_HEIGHT = {
  collapsedMac: 50, collapsed: 8,
}

function getRailInitial(title: string): string {
  return title.trim().slice(0, 1).toUpperCase() || '·'
}

export function SidebarNavigationView({
  mode, isMac, hasUpdate, hasEnvironmentIssues, userAvatar,
  railRecentItems, onExpand, onRailModeSwitch,
  onNewConversation, onNewAgentSession, onSearch, onSettings,
  onSelectAgent, onSelectChat,
}: SidebarNavigationViewProps): React.ReactElement {
  return (
    <div className="relative h-full flex flex-col items-center bg-background rounded-2xl shadow-xl transition-[width] duration-300 px-2"
      style={{ width: 60, flexShrink: 0 }}
    >
      <div aria-hidden="true" className="sidebar-window-drag-strip"
        style={{ height: isMac ? SIDEBAR_DRAG_STRIP_HEIGHT.collapsedMac : SIDEBAR_DRAG_STRIP_HEIGHT.collapsed }}
      />
      <div className={cn('w-full flex-shrink-0 titlebar-drag-region', isMac ? 'h-[50px]' : 'h-2')} />

      <div className="pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="展开侧边栏" onClick={onExpand}
              className="size-10 flex items-center justify-center rounded-[12px] text-foreground/60 bg-muted hover:bg-foreground/[0.08] hover:text-foreground transition-colors titlebar-no-drag">
              <PanelLeftOpen size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">展开侧边栏 ({navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})</TooltipContent>
        </Tooltip>
      </div>

      <div className="my-3 h-px w-8 bg-border/70" />

      <div className="flex flex-col items-center gap-1.5">
        <CollapsedWorkspacePopover>
          <button type="button" aria-label="切换到 Agent 模式"
            onClick={() => onRailModeSwitch('agent')}
            className={cn(
              'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag',
              mode === 'agent'
                ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                : 'text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75',
            )}>
            <Bot size={18} />
          </button>
        </CollapsedWorkspacePopover>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="切换到 Chat 模式" onClick={() => onRailModeSwitch('chat')}
              className={cn(
                'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag',
                mode === 'chat'
                  ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                  : 'text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75',
              )}>
              <MessageSquare size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Chat 模式</TooltipContent>
        </Tooltip>
      </div>

      <div className="my-3 h-px w-8 bg-border/70" />

      <div className="flex flex-col items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button"
              aria-label={mode === 'agent' ? '新建 Agent 会话' : '新建 Chat 对话'}
              onClick={mode === 'agent' ? onNewAgentSession : onNewConversation}
              className="size-10 flex items-center justify-center rounded-[12px] text-foreground/70 bg-primary/5 hover:bg-primary/10 transition-colors titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]">
              <Plus size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{mode === 'agent' ? '新会话' : '新对话'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="搜索" onClick={onSearch}
              className="size-10 flex items-center justify-center rounded-[12px] text-foreground/45 bg-primary/5 hover:bg-primary/10 hover:text-foreground/70 transition-colors titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]">
              <Search size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">搜索</TooltipContent>
        </Tooltip>
      </div>

      <div className="my-3 h-px w-8 bg-border/70" />

      <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-none">
        <div className="flex flex-col items-center gap-1.5 pb-2">
          {railRecentItems.map((item) => (
            <Tooltip key={`${item.type}-${item.id}`}>
              <TooltipTrigger asChild>
                <button type="button"
                  aria-label={`打开${item.type === 'agent' ? 'Agent 会话' : 'Chat 对话'}：${item.title}`}
                  onClick={() => {
                    item.type === 'agent'
                      ? onSelectAgent(item.id, item.title)
                      : onSelectChat(item.id, item.title)
                  }}
                  className={cn(
                    'relative size-10 flex items-center justify-center overflow-hidden rounded-[12px] transition-colors titlebar-no-drag',
                    item.active
                      ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                      : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/80',
                  )}>
                  <span className={cn('absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full pointer-events-none', RAIL_STATUS_CLASS[item.status])} />
                  <span className="text-[13px] font-semibold leading-none">{item.initial}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.type === 'agent' ? 'Agent' : 'Chat'} · {item.title}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="pt-3 pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="打开设置" onClick={onSettings}
              className="relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag hover:bg-foreground/5">
              <UserAvatar avatar={userAvatar} size={28} />
              {(hasUpdate || hasEnvironmentIssues) && (
                <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">设置</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export { getRailInitial, SIDEBAR_DRAG_STRIP_HEIGHT, RAIL_STATUS_CLASS }
