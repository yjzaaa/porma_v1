import * as React from 'react'
import { Pin, PinOff, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, Hammer, ArrowRightLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { AgentSessionMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

type SessionLeftAccent = 'orange' | 'blue' | 'green'
const SESSION_LEFT_ACCENT_CLASS: Record<SessionLeftAccent, string> = {
  orange: 'bg-orange-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
}

export interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  indicatorStatus: SessionIndicatorStatus
  showPinIcon?: boolean
  isInWorkingSection?: boolean
  leftAccent?: SessionLeftAccent
  workspaceName?: string
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleManualWorking: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

export const AgentSessionItem = React.memo(function AgentSessionItem({
  session, active, indicatorStatus, showPinIcon, isInWorkingSection, leftAccent, workspaceName,
  onSelect, onRequestDelete, onRequestMove, onRename, onTogglePin, onToggleManualWorking, onToggleArchive,
}: AgentSessionItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const startEdit = (): void => {
    setEditTitle(session.title)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  const saveTitle = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) { setEditing(false); return }
    await onRename(session.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); saveTitle() }
    else if (e.key === 'Escape') setEditing(false)
  }

  const isWorking = isInWorkingSection || session.manualWorking
  const canMove = indicatorStatus === 'idle' || indicatorStatus === 'completed'

  const menuItems = (
    MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem,
    MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(session.id)}>
        {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        {session.pinned ? '取消置顶' : '置顶会话'}
      </MenuItem>
      <MenuItem
        className="text-xs py-1 [&>svg]:size-3.5"
        disabled={indicatorStatus === 'running'}
        onSelect={() => { if (indicatorStatus !== 'running') onToggleManualWorking(session.id) }}
      >
        <Hammer size={14} className={isWorking ? 'fill-current' : ''} />
        {indicatorStatus === 'running' ? '运行中无法移出' : isWorking ? '取消工作中' : '标记为工作中'}
      </MenuItem>
      {canMove && (
        <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onRequestMove(session.id)}>
          <ArrowRightLeft size={14} />迁移到其他工作区
        </MenuItem>
      )}
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(session.id)}>
        {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {session.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(session.id)}>
        <Trash2 size={14} />删除会话
      </MenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button" tabIndex={0}
          onClick={() => onSelect(session.id, session.title)}
          onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}
          className={cn(
            'group relative w-full flex items-center gap-2 px-3 py-[7px] rounded-md transition-colors duration-100 titlebar-no-drag text-left',
            active
              ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
              : 'hover:bg-primary/5',
          )}
        >
          {leftAccent && (
            <span className={cn('absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full pointer-events-none', SESSION_LEFT_ACCENT_CLASS[leftAccent])} />
          )}
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef} value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown} onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
                maxLength={100}
              />
            ) : (
              <div className={cn('truncate text-[13px] leading-5 flex items-center gap-1.5', active ? 'text-foreground' : 'text-foreground/80')}>
                {showPinIcon && <Pin size={11} className="flex-shrink-0 text-primary/60" />}
                <span className="truncate">{session.title}</span>
                {workspaceName && (
                  <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[80px]">
                    {workspaceName}
                  </span>
                )}
              </div>
            )}
          </div>
          {!editing && (
            <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={cn(
                    'p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors',
                    'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
                    'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/60 data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
                  )}>
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                  {menuItems(DropdownMenuItem, DropdownMenuSeparator)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  )
})
