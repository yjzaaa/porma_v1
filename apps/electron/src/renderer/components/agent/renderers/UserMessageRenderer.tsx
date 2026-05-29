import * as React from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { userProfileAtom } from '@/atoms/user-profile'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { CopyButton } from '@/components/chat/CopyButton'
import {
  Message, MessageContent, MessageActions, UserMessageContent,
} from '@/components/ai-elements/message'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { extractMeta, extractUserText } from '../utils/message-meta'
import { AttachedImageThumb, AttachedFileChip, QuoteChip, parseAttachedFiles, isImageFile } from './FileAttachmentRenderer'
import type { SDKUserMessage, SDKSystemMessage, SDKMessage } from '@proma/shared'

export function CompactBoundaryDivider(): React.ReactElement {
  return (
    <div className="flex items-center gap-3 my-4 px-1">
      <div className="flex-1 h-px bg-border/40" />
      <span className="shrink-0 text-[11px] text-muted-foreground/60 px-2 py-0.5 rounded-full border border-border/30 bg-muted/20">
        上下文已压缩
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

export function CompactingIndicator(): React.ReactElement {
  return (
    <div className="flex items-center gap-3 my-4 px-1">
      <div className="flex-1 h-px bg-border/40" />
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70 px-2 py-0.5 rounded-full border border-border/30 bg-muted/20">
        <Loader2 className="size-3 animate-spin" />
        正在压缩...
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

function formatSystemToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

export function PermissionDeniedNotice({ message }: { message: SDKSystemMessage }): React.ReactElement {
  const toolName = typeof message.tool_name === 'string' ? formatSystemToolName(message.tool_name) : undefined
  const denialMessage = typeof message.message === 'string' ? message.message : undefined
  const reason = typeof message.decision_reason === 'string' ? message.decision_reason : undefined

  return (
    <div className="my-3 pl-[46px] pr-1">
      <div className="flex items-start gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-foreground/80">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">自动审批已拒绝操作</span>
            {toolName && (
              <span className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {toolName}
              </span>
            )}
          </div>
          {denialMessage && <p className="break-words text-muted-foreground">{denialMessage}</p>}
          {reason && reason !== denialMessage && (
            <p className="break-words text-muted-foreground/70">{reason}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function UserInputMessage({ message }: { message: SDKUserMessage }): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const rawText = extractUserText(message) ?? ''
  const { files: attachedFiles, quotes, text } = parseAttachedFiles(rawText)
  const imageFiles = attachedFiles.filter((f) => isImageFile(f.filename))
  const nonImageFiles = attachedFiles.filter((f) => !isImageFile(f.filename))
  const meta = extractMeta(message as unknown as SDKMessage)

  return (
    <Message from="user">
      <div className="flex items-start gap-2.5 mb-2.5">
        <UserAvatar avatar={userProfile.avatar} size={35} />
        <div className="flex flex-col justify-between h-[35px]">
          <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
          {meta.createdAt && (
            <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(meta.createdAt)}</span>
          )}
        </div>
      </div>
      <MessageContent>
        {quotes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {quotes.map((q, i) => (
              <QuoteChip key={`${q.path}:${i}`} quote={q} />
            ))}
          </div>
        )}
        {imageFiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mb-2">
            {imageFiles.map((file) => (
              <AttachedImageThumb key={file.path} file={file} />
            ))}
          </div>
        )}
        {nonImageFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {nonImageFiles.map((file) => (
              <AttachedFileChip key={file.path} file={file} />
            ))}
          </div>
        )}
        {text && <UserMessageContent>{text}</UserMessageContent>}
      </MessageContent>
      {text && (
        <MessageActions className="pl-[46px] mt-0.5">
          <CopyButton content={text} />
        </MessageActions>
      )}
    </Message>
  )
}
