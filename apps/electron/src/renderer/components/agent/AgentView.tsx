/**
 * AgentView — Agent 模式主视图容器（聚合根）
 *
 * 职责：
 * - 组合子视图和 hooks，不做业务逻辑
 * - IPC 流式事件监听已提升到全局 useGlobalAgentListeners
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { CornerDownLeft, Square, Paperclip, FolderPlus, Brain, Eye } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { PermissionBanner } from './PermissionBanner'
import { AskUserBanner } from './AskUserBanner'
import { ExitPlanModeBanner } from './ExitPlanModeBanner'
import { AgentThinkingPopover } from './_internals/AgentThinkingPopover'
import { DisplayOptionsPopover } from './_internals/DisplayOptionsPopover'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  agentThinkingAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  agentChannelIdsAtom,
  agentPlanModeSessionsAtom,
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  sessionPersistedPermissionModeAtom,
  agentProcessGroupsKeepExpandedAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
} from '@/atoms/agent-atoms'
import type { AgentContextStatus } from '@/atoms/agent-atoms'
import { autoPreviewEnabledAtom, previewPanelOpenMapAtom, quotedSelectionMapAtom, currentQuotedSelectionAtom } from '@/atoms/preview-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { AgentSessionProvider } from '@/contexts/session-context'
import { SpeechButton } from '@/components/ai-elements/speech-button'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionModeSelector } from './PermissionModeSelector'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { InputToolbarOverflow, type ToolbarItem } from '@/components/ai-elements/InputToolbarOverflow'
import type { ModelOption, ThinkingConfig } from '@proma/shared'
import { useAgentSessionLoad } from './hooks/useAgentSessionLoad'
import { useAgentSend } from './hooks/useAgentSend'
import { useAgentFileAttach } from './hooks/useAgentFileAttach'
import { useAgentStop } from './hooks/useAgentStop'
import { useAgentRetry } from './hooks/useAgentRetry'
import { AgentInputView } from './views/AgentInputView'
import { cn } from '@/lib/utils'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { registerShortcut } from '@/lib/shortcut-registry'

const LONG_TEXT_ATTACHMENT_THRESHOLD = 2000

/** 附加文件按钮 */
function AttachFileButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon"
          className="size-[36px] shrink-0 rounded-full text-foreground/60 hover:text-foreground" onClick={onClick}>
          <Paperclip className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top"><p>添加附件</p></TooltipContent>
    </Tooltip>
  )
}

/** 附加文件夹按钮 */
function AttachFolderButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon"
          className="size-[36px] shrink-0 rounded-full text-foreground/60 hover:text-foreground" onClick={onClick}>
          <FolderPlus className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top"><p>附加文件夹</p></TooltipContent>
    </Tooltip>
  )
}

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const store = useStore()

  // ---- Hooks ----
  const sessionLoad = useAgentSessionLoad(sessionId)
  const fileAttach = useAgentFileAttach(sessionId)
  const sendHook = useAgentSend(sessionId, {
    attachedDirs: fileAttach.attachedDirs,
    attachedFileDirectories: fileAttach.attachedFileDirectories,
    pendingFiles: fileAttach.pendingFiles,
    setPendingFiles: fileAttach.setPendingFiles,
    pendingFilesRef: fileAttach.pendingFilesRef,
    streaming: sessionLoad.streaming,
    currentWorkspaceId: sessionLoad.currentWorkspaceId,
    permissionMode: undefined,
  })
  const stopHook = useAgentStop(sessionId)
  const retryHook = useAgentRetry(sessionId, sessionLoad.persistedSDKMessages)

  // ---- Atoms ----
  const sessionChannelMap = useAtomValue(agentSessionChannelMapAtom)
  const sessionModelMap = useAtomValue(agentSessionModelMapAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const [defaultChannelId, setDefaultChannelId] = useAtom(agentChannelIdAtom)
  const [defaultModelId, setDefaultModelId] = useAtom(agentModelIdAtom)
  const agentChannelId = sessionChannelMap.get(sessionId) ?? defaultChannelId
  const agentModelId = sessionModelMap.get(sessionId) ?? defaultModelId
  const [agentChannelIds, setAgentChannelIds] = useAtom(agentChannelIdsAtom)
  const [agentThinking, setAgentThinking] = useAtom(agentThinkingAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setPreviewOpenMap = useSetAtom(previewPanelOpenMapAtom)
  const currentQuotedSelection = useAtomValue(currentQuotedSelectionAtom)
  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const [autoPreviewEnabled, setAutoPreviewEnabled] = useAtom(autoPreviewEnabledAtom)
  const [processGroupsKeepExpanded, setProcessGroupsKeepExpanded] = useAtom(agentProcessGroupsKeepExpandedAtom)

  // ---- 派生状态 ----
  const contextStatus: AgentContextStatus = {
    isCompacting: sessionLoad.streamState?.isCompacting ?? false,
    inputTokens: sessionLoad.streamState?.inputTokens,
    contextWindow: sessionLoad.streamState?.contextWindow,
  }
  const planModeSessions = useAtomValue(agentPlanModeSessionsAtom)
  const isPlanMode = planModeSessions.has(sessionId)
  const permissionModeMap = useAtomValue(agentPermissionModeMapAtom)
  const defaultPermissionMode = useAtomValue(agentDefaultPermissionModeAtom)
  const persistedPermissionMode = useAtomValue(sessionPersistedPermissionModeAtom(sessionId))
  const permissionMode = permissionModeMap.get(sessionId) ?? persistedPermissionMode ?? defaultPermissionMode
  const isPermissionPlanMode = permissionMode === 'plan'
  const allAskUserRequests = useAtomValue(allPendingAskUserRequestsAtom)
  const allExitPlanRequests = useAtomValue(allPendingExitPlanRequestsAtom)
  const hasBannerOverlay =
    (allAskUserRequests.get(sessionId)?.length ?? 0) > 0 ||
    (allExitPlanRequests.get(sessionId)?.length ?? 0) > 0
  const hasTextInput = sendHook.inputContent.trim().length > 0

  // ---- 回调 ----
  const handleModelSelect = React.useCallback((option: ModelOption): void => {
    setSessionChannelMap((prev) => { const map = new Map(prev); map.set(sessionId, option.channelId); return map })
    setSessionModelMap((prev) => { const map = new Map(prev); map.set(sessionId, option.modelId); return map })
    const updated = agentChannelIds.includes(option.channelId) ? agentChannelIds : [...agentChannelIds, option.channelId]
    if (updated !== agentChannelIds) setAgentChannelIds(updated)
    setDefaultChannelId(option.channelId); setDefaultModelId(option.modelId)
    window.electronAPI.updateSettings({ agentChannelId: option.channelId, agentModelId: option.modelId, agentChannelIds: updated }).catch(console.error)
  }, [sessionId, setSessionChannelMap, setSessionModelMap, setDefaultChannelId, setDefaultModelId, agentChannelIds, setAgentChannelIds])

  const togglePreviewPanel = React.useCallback(() => {
    setPreviewOpenMap((prev) => { const m = new Map(prev); const current = m.get(sessionId) ?? false; m.set(sessionId, !current); return m })
  }, [sessionId, setPreviewOpenMap])

  React.useEffect(() => registerShortcut('toggle-preview-panel', togglePreviewPanel), [togglePreviewPanel])

  const externalSelectedModel = React.useMemo(() => {
    return (agentChannelId && agentModelId) ? { channelId: agentChannelId, modelId: agentModelId } : null
  }, [agentChannelId, agentModelId])

  const handleToggleThinking = React.useCallback(() => {
    const next = agentThinking?.type === 'adaptive' ? { type: 'disabled' as const } : { type: 'adaptive' as const }
    setAgentThinking(next)
    window.electronAPI.updateSettings({ agentThinking: next })
  }, [agentThinking, setAgentThinking])

  const handleRemoveQuotedSelection = React.useCallback(() => {
    setQuotedSelectionMap((prev) => { const m = new Map(prev); m.delete(sessionId); return m })
  }, [sessionId, setQuotedSelectionMap])

  // ---- 工具栏 ----
  const inputToolbarItems = React.useMemo<ToolbarItem[]>(() => [
    { key: 'model', node: <ModelSelector filterChannelIds={agentChannelIds} externalSelectedModel={externalSelectedModel} onModelSelect={handleModelSelect} /> },
    { key: 'permission-mode', node: <PermissionModeSelector sessionId={sessionId} /> },
    { key: 'thinking', node: <AgentThinkingPopover agentThinking={agentThinking} onToggle={handleToggleThinking} /> },
    { key: 'speech', node: <SpeechButton className="size-[36px] shrink-0 rounded-full" /> },
    { key: 'attach-file', node: <AttachFileButton onClick={fileAttach.attachFromDialog} /> },
    { key: 'attach-folder', node: <AttachFolderButton onClick={fileAttach.attachFolder} /> },
    {
      key: 'context-usage', node: (
        <ContextUsageBadge inputTokens={contextStatus.inputTokens} outputTokens={contextStatus.outputTokens}
          cacheReadTokens={contextStatus.cacheReadTokens} cacheCreationTokens={contextStatus.cacheCreationTokens}
          contextWindow={contextStatus.contextWindow} isCompacting={contextStatus.isCompacting}
          isProcessing={sessionLoad.streaming} onCompact={() => stopHook.compact(agentModelId || undefined)} />
      ),
    },
    { key: 'auto-preview', node: <DisplayOptionsPopover autoPreviewEnabled={autoPreviewEnabled} processGroupsKeepExpanded={processGroupsKeepExpanded} onAutoPreviewChange={setAutoPreviewEnabled} onProcessGroupsKeepExpandedChange={setProcessGroupsKeepExpanded} /> },
  ], [agentChannelIds, externalSelectedModel, handleModelSelect, agentThinking, handleToggleThinking,
      fileAttach.attachFromDialog, fileAttach.attachFolder, contextStatus, sessionLoad.streaming, stopHook.compact,
      autoPreviewEnabled, processGroupsKeepExpanded, setAutoPreviewEnabled, setProcessGroupsKeepExpanded, agentModelId])

  const inputTrailingNode = sessionLoad.streaming && !hasTextInput ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon"
          className="size-[36px] rounded-full text-destructive hover:!text-[hsl(0,75%,55%)] hover:!bg-[var(--stop-hover-bg)]" onClick={stopHook.stop}>
          <Square className="size-[16px]" fill="currentColor" strokeWidth={0} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top"><p>停止 Agent ({getAcceleratorDisplay(getActiveAccelerator('stop-generation'))})</p></TooltipContent>
    </Tooltip>
  ) : (
    <Button type="button" variant="ghost" size="icon"
      className={cn('size-[36px] rounded-full', sendHook.canSend ? 'text-primary hover:bg-primary/10' : 'text-foreground/30 cursor-not-allowed')}
      onClick={sendHook.send} disabled={!sendHook.canSend}>
      <CornerDownLeft className="size-[22px]" />
    </Button>
  )

  // ---- 快捷键 ----
  React.useEffect(() => {
    const handler = (): void => { if (sessionLoad.streaming) stopHook.stop() }
    window.addEventListener('proma:stop-generation', handler)
    return () => window.removeEventListener('proma:stop-generation', handler)
  }, [sessionLoad.streaming, stopHook.stop])

  React.useEffect(() => {
    const handler = (): void => {
      const proseMirror = document.querySelector('[data-input-mode="agent"] .ProseMirror') as HTMLElement | null
      proseMirror?.focus()
    }
    window.addEventListener('proma:focus-input', handler)
    return () => window.removeEventListener('proma:focus-input', handler)
  }, [])

  if (!sessionLoad.messagesLoaded) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
  }

  return (
    <AgentSessionProvider sessionId={sessionId}>
      <div className="flex flex-col h-full flex-1 min-w-0 max-w-[min(72rem,100%)] mx-auto">
        <AgentHeader sessionId={sessionId} />

        <AgentMessages
          sessionId={sessionId}
          sessionModelId={agentModelId || undefined}
          messagesLoaded={sessionLoad.messagesLoaded}
          persistedSDKMessages={sessionLoad.persistedSDKMessages}
          streaming={sessionLoad.streaming}
          streamState={sessionLoad.streamState}
          liveMessages={sessionLoad.liveMessages}
          sessionPath={sessionLoad.sessionPath}
          attachedDirs={fileAttach.allAttachedDirs}
          stoppedByUser={sessionLoad.stoppedByUser}
          onRetry={retryHook.retry}
          onRetryInNewSession={retryHook.retryInNewSession}
          onFork={retryHook.fork}
          onRewind={retryHook.rewindRequest}
          onCompact={() => stopHook.compact(agentModelId || undefined)}
        />

        <PermissionBanner sessionId={sessionId} />
        <AskUserBanner sessionId={sessionId} />
        <ExitPlanModeBanner sessionId={sessionId} />

        {!hasBannerOverlay && (
          <AgentInputView
            sessionId={sessionId}
            inputContent={sendHook.inputContent}
            inputHtmlContent={sendHook.inputHtmlContent}
            onInputChange={sendHook.setInputContent}
            onInputHtmlChange={sendHook.setInputHtmlContent}
            onSend={sendHook.send}
            canSend={sendHook.canSend}
            streaming={sessionLoad.streaming}
            hasTextInput={hasTextInput}
            hasChannelWarning={sendHook.hasChannelWarning}
            agentChannelId={sendHook.agentChannelId}
            agentChannelIds={agentChannelIds}
            hasAvailableModel={sendHook.hasAvailableModel}
            suggestion={sendHook.suggestion}
            onDismissSuggestion={() => { }}
            onStop={stopHook.stop}
            onCompact={() => stopHook.compact(agentModelId || undefined)}
            error={stopHook.error}
            contextStatus={contextStatus}
            isDragOver={fileAttach.isDragOver}
            isPlanMode={isPlanMode}
            isPermissionPlanMode={isPermissionPlanMode}
            onDragOver={fileAttach.handleDragOver}
            onDragLeave={fileAttach.handleDragLeave}
            onDrop={fileAttach.handleDrop}
            externalSelectedModel={externalSelectedModel}
            onModelSelect={handleModelSelect}
            onOpenFileDialog={fileAttach.attachFromDialog}
            onAttachFolder={fileAttach.attachFolder}
            agentThinking={agentThinking}
            onToggleThinking={handleToggleThinking}
            autoPreviewEnabled={autoPreviewEnabled}
            processGroupsKeepExpanded={processGroupsKeepExpanded}
            onAutoPreviewChange={setAutoPreviewEnabled}
            onProcessGroupsKeepExpandedChange={setProcessGroupsKeepExpanded}
            onPasteFiles={fileAttach.handlePasteFiles}
            onPasteLongText={fileAttach.handlePasteLongText}
            onSettingsOpen={() => setSettingsOpen(true)}
            inputToolbarItems={inputToolbarItems}
            sessionPath={sessionLoad.sessionPath}
            currentWorkspaceId={sessionLoad.currentWorkspaceId}
            workspaceSlug={sessionLoad.workspaceSlug}
            workspaceMentionPaths={fileAttach.workspaceMentionPaths}
            sessionMentionPaths={fileAttach.sessionMentionPaths}
            sendWithCmdEnter={sessionLoad.sendWithCmdEnter}
            longTextPasteThreshold={LONG_TEXT_ATTACHMENT_THRESHOLD}
            inputTrailingNode={inputTrailingNode}
            pendingFiles={fileAttach.pendingFiles}
            onRemoveFile={fileAttach.removeFile}
            onClipboardPreview={fileAttach.handleClipboardPreview}
            quotedSelection={currentQuotedSelection}
            onRemoveQuotedSelection={handleRemoveQuotedSelection}
          />
        )}

        {/* Rewind 确认弹窗 */}
        <AlertDialog open={retryHook.rewindTargetUuid !== null} onOpenChange={(v) => { if (!v) retryHook.setRewindTargetUuid(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认回退</AlertDialogTitle>
              <AlertDialogDescription>回退将截断该消息之后的所有对话，并恢复文件到该时刻的状态。此操作不可撤销，确定要回退吗？</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={retryHook.rewindConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">回退</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AgentSessionProvider>
  )
}
