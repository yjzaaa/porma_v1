import * as React from 'react'
import { Pin, PinOff, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { ConversationMeta } from '@proma/shared'

export interface ConversationItemProps {
  conversation: ConversationMeta
  active: boolean
  streaming: boolean
  showPinIcon: boolean
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

export const ConversationItem = React.memo(function ConversationItem({
  conversation,
  active,
  streaming,
  showPinIcon,
  onSelect,
  onRequestDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
}: ConversationItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const startEdit = (): void => {
    setEditTitle(conversation.title)
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
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false)
      return
    }
    await onRename(conversation.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); saveTitle() }
    else if (e.key === 'Escape') setEditing(false)
  }

  const isPinned = !!conversation.pinned

  const menuItems = (
    MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem,
    MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(conversation.id)}>
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? '取消置顶' : '置顶对话'}
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(conversation.id)}>
        {conversation.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {conversation.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(conversation.id)}>
        <Trash2 size={14} />删除对话
      </MenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button" tabIndex={0}
          onClick={() => onSelect(conversation.id, conversation.title)}
          onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}
          className={cn(
            'group relative w-full flex items-center gap-2 px-3 py-[7px] rounded-md transition-colors duration-100 titlebar-no-drag text-left',
            active
              ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
              : 'hover:bg-primary/5',
          )}
        >
          {streaming && (
            <span className="absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full bg-blue-500 animate-pulse pointer-events-none" aria-hidden="true" />
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
                <span className="truncate">{conversation.title}</span>
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
