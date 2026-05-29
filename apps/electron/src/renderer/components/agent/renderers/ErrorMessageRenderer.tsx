import * as React from 'react'
import { AlertTriangle, RotateCw, Plus, Minimize2, Wrench, Settings, ExternalLink } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { environmentCheckDialogOpenAtom } from '@/atoms/environment'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { CopyButton } from '@/components/chat/CopyButton'
import { Button } from '@/components/ui/button'
import {
  Message, MessageHeader, MessageContent, MessageActions, MessageResponse,
} from '@/components/ai-elements/message'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { extractMeta } from '../utils/message-meta'
import {
  THINKING_SIGNATURE_ERROR_CODE, THINKING_SIGNATURE_ERROR_TITLE, THINKING_SIGNATURE_ERROR_MESSAGE,
  isThinkingSignatureError,
} from '@proma/shared'
import type { SDKAssistantMessage, SDKMessage, RecoveryAction } from '@proma/shared'

export interface ErrorMessageProps {
  message: SDKAssistantMessage
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
}

export function ErrorMessage({ message, onRetry, onRetryInNewSession, onCompact }: ErrorMessageProps): React.ReactElement {
  const meta = extractMeta(message as unknown as SDKMessage)
  const errorText = message.error?.message ?? '未知错误'
  const msgAny = message as unknown as Record<string, unknown>
  const errorTitle = typeof msgAny._errorTitle === 'string' ? msgAny._errorTitle : undefined
  const errorCode = typeof msgAny._errorCode === 'string' ? msgAny._errorCode : undefined
  const errorDetails = Array.isArray(msgAny._errorDetails) ? (msgAny._errorDetails as string[]) : undefined
  const errorActions = Array.isArray(msgAny._errorActions) ? (msgAny._errorActions as RecoveryAction[]) : undefined
  const isPromptTooLong = errorCode === 'prompt_too_long'

  const setEnvDialogOpen = useSetAtom(environmentCheckDialogOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  const contentText = message.message?.content
    ?.filter((b) => b.type === 'text' && 'text' in b)
    .map((b) => (b as { text: string }).text)
    .join('\n') ?? errorText
  const isThinkingSignature = errorCode === THINKING_SIGNATURE_ERROR_CODE ||
    isThinkingSignatureError(contentText, errorText)
  const displayTitle = errorTitle ?? (isThinkingSignature ? THINKING_SIGNATURE_ERROR_TITLE : undefined)
  const displayContentText = isThinkingSignature ? THINKING_SIGNATURE_ERROR_MESSAGE : contentText
  const displayedErrorActions = (errorActions ?? []).filter((action) => {
    if (action.action === 'retry' && !onRetry) return false
    if (action.action === 'compact' && !onCompact) return false
    if (action.action === 'retry_in_new_session' && !onRetryInNewSession) return false
    return true
  })

  const handleRecoveryAction = (action: RecoveryAction) => {
    switch (action.action) {
      case 'open_environment_check': setEnvDialogOpen(true); break
      case 'open_channel_settings': setSettingsTab('channels'); setSettingsOpen(true); break
      case 'settings': setSettingsOpen(true); break
      case 'open_external': if (action.payload) window.electronAPI.openExternal(action.payload); break
      case 'retry': onRetry?.(); break
      case 'compact': onCompact?.(); break
      case 'retry_in_new_session': onRetryInNewSession?.(); break
      default: console.warn('[ErrorMessage] 未处理的 recovery action:', action)
    }
  }

  const iconForAction = (action: RecoveryAction['action']) => {
    switch (action) {
      case 'open_environment_check': return <Wrench className="size-3.5 mr-1.5" />
      case 'open_channel_settings': case 'settings': return <Settings className="size-3.5 mr-1.5" />
      case 'open_external': return <ExternalLink className="size-3.5 mr-1.5" />
      case 'retry': return <RotateCw className="size-3.5 mr-1.5" />
      case 'compact': return <Minimize2 className="size-3.5 mr-1.5" />
      case 'retry_in_new_session': return <Plus className="size-3.5 mr-1.5" />
      default: return null
    }
  }

  const hasStructuredActions = displayedErrorActions.length > 0
  const hasLegacyActions = !!(onRetry || onRetryInNewSession || (isPromptTooLong && onCompact))
  const hasActions = hasStructuredActions || hasLegacyActions

  return (
    <Message from="assistant">
      <MessageHeader
        model={undefined}
        time={meta.createdAt ? formatMessageTime(meta.createdAt) : undefined}
        logo={
          <div className="size-[35px] rounded-[25%] bg-destructive/10 flex items-center justify-center">
            <AlertTriangle size={18} className="text-destructive" />
          </div>
        }
      />
      <MessageContent>
        {displayTitle && <div className="text-sm font-medium text-destructive mb-1">{displayTitle}</div>}
        <div className="text-destructive">
          <MessageResponse>{displayContentText}</MessageResponse>
        </div>
        {errorDetails && errorDetails.length > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            <button type="button" onClick={() => setDetailsOpen((v) => !v)} className="underline-offset-2 hover:underline">
              {detailsOpen ? '收起诊断详情' : '查看诊断详情'}
            </button>
            {detailsOpen && (
              <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                {errorDetails.map((d, i) => (<li key={i}>{d}</li>))}
              </ul>
            )}
          </div>
        )}
        {hasActions && (
          <div className="flex items-center flex-wrap gap-2 mt-3">
            {hasStructuredActions && displayedErrorActions.map((a, i) => (
              <Button key={`${a.action}-${i}`} size="sm" variant={i === 0 ? 'default' : 'outline'} onClick={() => handleRecoveryAction(a)}>
                {iconForAction(a.action)}{a.label}
              </Button>
            ))}
            {!hasStructuredActions && isPromptTooLong && onCompact && (
              <Button size="sm" onClick={onCompact}><Minimize2 className="size-3.5 mr-1.5" />压缩上下文</Button>
            )}
            {!hasStructuredActions && isThinkingSignature && onRetryInNewSession && (
              <Button size="sm" onClick={onRetryInNewSession} title="新建对话并引用当前会话继续"><Plus className="size-3.5 mr-1.5" />在新对话继续</Button>
            )}
            {!hasStructuredActions && onRetry && (
              <Button size="sm" variant={isPromptTooLong || isThinkingSignature ? 'outline' : 'default'} onClick={onRetry}><RotateCw className="size-3.5 mr-1.5" />重试</Button>
            )}
            {!hasStructuredActions && !isThinkingSignature && onRetryInNewSession && (
              <Button size="sm" variant="outline" onClick={onRetryInNewSession} title="如遇到未知错误，可点此按钮在新会话中尝试解决"><Plus className="size-3.5 mr-1.5" />在新会话中重试</Button>
            )}
          </div>
        )}
      </MessageContent>
      <MessageActions className="pl-[46px] mt-0.5">
        <CopyButton content={displayContentText} />
      </MessageActions>
    </Message>
  )
}
