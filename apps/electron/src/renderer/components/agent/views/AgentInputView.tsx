import * as React from 'react'
import { Settings, Square, CornerDownLeft, MapIcon } from 'lucide-react'
import { ContextUsageBadge } from '@/components/agent/ContextUsageBadge'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { SpeechButton } from '@/components/ai-elements/speech-button'
import { InputToolbarOverflow, type ToolbarItem } from '@/components/ai-elements/InputToolbarOverflow'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { PlanModeDashedBorder } from '@/components/agent/PlanModeDashedBorder'

import { PermissionModeSelector } from '@/components/agent/PermissionModeSelector'
import { AgentThinkingPopover } from '@/components/agent/_internals/AgentThinkingPopover'
import { DisplayOptionsPopover } from '@/components/agent/_internals/DisplayOptionsPopover'
import type { ThinkingConfig, AgentPendingFile, ModelOption } from '@proma/shared'
import { AgentAttachmentView } from './AgentAttachmentView'
import type { AgentContextStatus } from '@/atoms/agent-atoms'

interface AgentInputViewProps {
  sessionId: string
  inputContent: string
  inputHtmlContent: string
  onInputChange: (value: string) => void
  onInputHtmlChange: (html: string) => void
  onSend: () => void
  canSend: boolean
  streaming: boolean
  hasTextInput: boolean
  hasChannelWarning: boolean
  agentChannelId: string | null
  agentChannelIds: string[]
  hasAvailableModel: boolean
  suggestion: string | null
  onDismissSuggestion: () => void
  onStop: () => void
  onCompact: () => void
  error: string | null
  contextStatus: AgentContextStatus
  isDragOver: boolean
  isPlanMode: boolean
  isPermissionPlanMode: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  externalSelectedModel: { channelId: string; modelId: string } | null
  onModelSelect: (option: ModelOption) => void
  onOpenFileDialog: () => void
  onAttachFolder: () => void
  agentThinking: ThinkingConfig | undefined
  onToggleThinking: () => void
  autoPreviewEnabled: boolean
  processGroupsKeepExpanded: boolean
  onAutoPreviewChange: (enabled: boolean) => void
  onProcessGroupsKeepExpandedChange: (expanded: boolean) => void
  onPasteFiles: (files: File[]) => void
  onPasteLongText: (text: string) => void
  onSettingsOpen: () => void
  inputToolbarItems: ToolbarItem[]
  sessionPath: string | null
  currentWorkspaceId: string | null
  workspaceSlug: string | null
  workspaceMentionPaths: string[]
  sessionMentionPaths: string[]
  sendWithCmdEnter: boolean
  longTextPasteThreshold: number
  inputTrailingNode: React.ReactNode
  pendingFiles: AgentPendingFile[]
  onRemoveFile: (id: string) => void
  onClipboardPreview: (file: AgentPendingFile) => void
  quotedSelection: { text: string; filePath: string } | null
  onRemoveQuotedSelection: () => void
}

export function AgentInputView({
  sessionId,
  inputContent,
  inputHtmlContent,
  onInputChange,
  onInputHtmlChange,
  onSend,
  canSend,
  streaming,
  hasTextInput,
  hasChannelWarning,
  agentChannelId,
  agentChannelIds,
  hasAvailableModel,
  suggestion,
  onDismissSuggestion,
  onStop,
  onCompact,
  error,
  contextStatus,
  isDragOver,
  isPlanMode,
  isPermissionPlanMode,
  onDragOver,
  onDragLeave,
  onDrop,
  externalSelectedModel,
  onModelSelect,
  onOpenFileDialog,
  onAttachFolder,
  agentThinking,
  onToggleThinking,
  autoPreviewEnabled,
  processGroupsKeepExpanded,
  onAutoPreviewChange,
  onProcessGroupsKeepExpandedChange,
  onPasteFiles,
  onPasteLongText,
  onSettingsOpen,
  inputToolbarItems,
  sessionPath,
  currentWorkspaceId,
  workspaceSlug,
  workspaceMentionPaths,
  sessionMentionPaths,
  sendWithCmdEnter,
  longTextPasteThreshold,
  inputTrailingNode,
  pendingFiles,
  onRemoveFile,
  onClipboardPreview,
  quotedSelection,
  onRemoveQuotedSelection,
}: AgentInputViewProps): React.ReactElement {
  return (
    <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px]" data-input-mode="agent">
      <div
        className={cn(
          'rounded-[17px] border-[0.5px] border-border bg-background/70 backdrop-blur-sm transition-all duration-200',
          (isPlanMode || isPermissionPlanMode) && !isDragOver && 'plan-mode-border',
          isDragOver && 'border-[2px] border-dashed border-[#2ecc71] bg-[#2ecc71]/[0.03]',
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {(isPlanMode || isPermissionPlanMode) && !isDragOver && <PlanModeDashedBorder />}

        {/* 附件 + 引用选中文本 Chip（同排并排） */}
        {pendingFiles && pendingFiles.length > 0 && (
          <AgentAttachmentView
            pendingFiles={pendingFiles}
            onRemoveFile={onRemoveFile}
            onClipboardPreview={onClipboardPreview}
            quotedSelection={quotedSelection}
            onRemoveQuotedSelection={onRemoveQuotedSelection}
          />
        )}

        {/* 无 Agent 渠道或无可用模型提示 */}
        {hasChannelWarning && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
            <Settings size={14} />
            <span>{!agentChannelId ? '请在设置中选择 Agent 供应商' : '暂无可用模型，请在设置中启用 Agent 渠道并配置模型'}</span>
            <button
              type="button"
              className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
              onClick={onSettingsOpen}
            >
              前往设置
            </button>
          </div>
        )}

        {/* Agent 建议提示 */}
        {suggestion && !streaming && (
          <div className="px-3 pt-2.5 pb-1.5">
            <button
              type="button"
              className="group flex items-start gap-2 w-full rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.06]"
              onClick={onSend}
            >
              <span className="flex-1 min-w-0 text-foreground/80 group-hover:text-foreground line-clamp-3">{suggestion}</span>
              <button
                type="button"
                className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
                onClick={(e) => { e.stopPropagation(); onDismissSuggestion() }}
                aria-label="关闭建议"
              >
                ✕
              </button>
            </button>
          </div>
        )}

        <RichTextInput
          value={inputContent}
          onChange={onInputChange}
          onSubmit={onSend}
          onPasteFiles={onPasteFiles}
          onPasteLongText={onPasteLongText}
          longTextPasteThreshold={longTextPasteThreshold}
          placeholder={
            agentChannelId && hasAvailableModel
              ? sendWithCmdEnter
                ? '输入消息... (⌘/Ctrl+Enter 发送，Enter 换行，@ 引用文件，/ 调用 Skill，# 调用 MCP，& 引用会话)'
                : '输入消息... (Enter 发送，Shift+Enter 换行，@ 引用文件，/ 调用 Skill，# 调用 MCP，& 引用会话)'
              : !agentChannelId
                ? '请先在设置中选择 Agent 供应商'
                : '暂无可用模型，请先在设置中启用渠道'
          }
          disabled={hasChannelWarning}
          autoFocusTrigger={sessionId}
          collapsible
          enableMentions
          workspacePath={sessionPath}
          workspaceId={currentWorkspaceId}
          workspaceSlug={workspaceSlug}
          sessionId={sessionId}
          attachedDirs={workspaceMentionPaths}
          sessionAttachedDirs={sessionMentionPaths}
          htmlValue={inputHtmlContent}
          onHtmlChange={onInputHtmlChange}
          sendWithCmdEnter={sendWithCmdEnter}
        />

        {/* Footer 工具栏 */}
        <InputToolbarOverflow items={inputToolbarItems} trailing={inputTrailingNode} />
      </div>

      {/* Plan 模式指示条 */}
      {isPlanMode && (
        <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 text-primary text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
          <MapIcon className="size-4 animate-pulse" />
          <span className="font-medium">Agent 正在规划中...</span>
          <span className="text-xs text-muted-foreground">完成后将请求你的审批</span>
        </div>
      )}
    </div>
  )
}
