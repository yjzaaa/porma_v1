import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { conversationsAtom, currentConversationIdAtom, streamingConversationIdsAtom } from '@/atoms/chat-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { promptConfigAtom, selectedPromptIdAtom } from '@/atoms/system-prompt-atoms'
import type { ConversationMeta } from '@proma/shared'

export interface ConversationActionsResult {
  conversations: ConversationMeta[]
  currentConversationId: string | null
  streamingIds: Set<string>
  pendingDeleteId: string | null
  setPendingDeleteId: (id: string | null) => void
  handleNewConversation: () => Promise<void>
  handleSelectConversation: (id: string, title?: string) => void
  handleConfirmDelete: () => Promise<void>
  handleRename: (id: string, newTitle: string) => Promise<void>
  handleTogglePin: (id: string) => Promise<void>
  handleToggleArchive: (id: string) => Promise<void>
}

export function useConversationActions(
  onOpenSession: (mode: 'chat' | 'agent', sessionId: string, title: string) => void,
): ConversationActionsResult {
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [currentConversationId, setCurrentConversationId] = useAtom(currentConversationIdAtom)
  const streamingIds = useAtomValue(streamingConversationIdsAtom)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)

  const handleNewConversation = React.useCallback(async (): Promise<void> => {
    try {
      const created = await window.electronAPI.createConversation()
      setConversations((prev) => [created, ...prev])
      setCurrentConversationId(created.id)
      onOpenSession('chat', created.id, created.title)
      setDraftSessionIds((prev) => { const next = new Set(prev); next.add(created.id); return next })

      if (promptConfig.defaultPromptId) {
        setSelectedPromptId(promptConfig.defaultPromptId)
      }
    } catch (error) {
      console.error('[LeftSidebar] 创建对话失败:', error)
      toast.error('创建对话失败')
    }
  }, [setConversations, setCurrentConversationId, onOpenSession, setDraftSessionIds, promptConfig.defaultPromptId, setSelectedPromptId])

  const handleSelectConversation = React.useCallback((id: string, title?: string): void => {
    setCurrentConversationId(id)
    const tabTitle = title ?? conversations.find((c) => c.id === id)?.title ?? '对话'
    onOpenSession('chat', id, tabTitle)
  }, [setCurrentConversationId, conversations, onOpenSession])

  const handleConfirmDelete = React.useCallback(async (): Promise<void> => {
    if (!pendingDeleteId) return
    try {
      await window.electronAPI.deleteConversation(pendingDeleteId)
      setConversations((prev) => prev.filter((c) => c.id !== pendingDeleteId))
      if (currentConversationId === pendingDeleteId) {
        setCurrentConversationId(null)
      }
      setPendingDeleteId(null)
    } catch (error) {
      console.error('[LeftSidebar] 删除对话失败:', error)
      toast.error('删除对话失败')
    }
  }, [pendingDeleteId, setConversations, currentConversationId, setCurrentConversationId])

  const handleRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
    try {
      await window.electronAPI.updateConversationTitle(id, newTitle)
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title: newTitle } : c))
    } catch (error) {
      console.error('[LeftSidebar] 重命名对话失败:', error)
      toast.error('重命名失败')
    }
  }, [setConversations])

  const handleTogglePin = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.togglePinConversation(id)
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, pinned: updated.pinned } : c))
    } catch (error) {
      console.error('[LeftSidebar] 置顶切换失败:', error)
      toast.error('置顶切换失败')
    }
  }, [setConversations])

  const handleToggleArchive = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveConversation(id)
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, archived: updated.archived } : c))
    } catch (error) {
      console.error('[LeftSidebar] 归档切换失败:', error)
      toast.error('归档切换失败')
    }
  }, [setConversations])

  return {
    conversations, currentConversationId, streamingIds,
    pendingDeleteId, setPendingDeleteId,
    handleNewConversation, handleSelectConversation, handleConfirmDelete,
    handleRename, handleTogglePin, handleToggleArchive,
  }
}
