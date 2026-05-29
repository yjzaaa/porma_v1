import * as React from 'react'
import { Bot, Split, Undo2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { ContentBlock } from '../ContentBlock'
import { TaskProgressCard } from '../TaskProgressCard'
import { TurnFileChangesSummary } from '../TurnFileChangesSummary'
import { ProcessBlockGroup, buildAssistantTurnRenderItems, buildCompletedToolResultIds } from '../ProcessBlockGroup'
import { extractToolResultText, parseTaskCreateResult, TASK_TOOL_NAMES } from '../task-progress'
import { DurationBadge } from '../AgentMessages'
import {
  Message, MessageHeader, MessageContent, MessageActions, MessageAction,
} from '@/components/ai-elements/message'
import { CopyButton } from '@/components/chat/CopyButton'
import { Badge } from '@/components/ui/badge'
import { channelsAtom } from '@/atoms/chat-atoms'
import { agentProcessGroupsKeepExpandedAtom } from '@/atoms/agent-atoms'
import { getModelLogo, resolveModelDisplayName } from '@/lib/model-logo'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { extractMeta, extractTurnUsage } from '../utils/message-meta'
import {
  THINKING_SIGNATURE_ERROR_TITLE, THINKING_SIGNATURE_ERROR_MESSAGE, isThinkingSignatureError,
} from '@proma/shared'
import type {
  SDKMessage, SDKAssistantMessage, SDKContentBlock, SDKToolUseBlock, SDKToolResultBlock,
  SDKUserMessage,
} from '@proma/shared'
import type { AssistantTurn } from '../utils/turn-grouper'
import { ErrorMessage } from './ErrorMessageRenderer'

function AssistantLogo({ model }: { model?: string }): React.ReactElement {
  if (model) {
    return (
      <img src={getModelLogo(model)} alt={model} className="size-[35px] rounded-[25%] object-cover" />
    )
  }
  return (
    <div className="size-[35px] rounded-[25%] bg-primary/10 flex items-center justify-center">
      <Bot size={18} className="text-primary" />
    </div>
  )
}

interface TaskActivity {
  toolUseId: string; toolName: string; input: Record<string, unknown>; result?: string; done: boolean
}

function buildTaskProgressData(
  topLevelBlocks: SDKContentBlock[],
  turnMessages: SDKMessage[],
): { taskActivities: TaskActivity[]; firstTaskIndex: number } {
  const taskBlocks: SDKToolUseBlock[] = []
  let firstTaskIndex = -1
  for (let i = 0; i < topLevelBlocks.length; i++) {
    const block = topLevelBlocks[i]!
    if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
      if (firstTaskIndex === -1) firstTaskIndex = i
      taskBlocks.push(block as SDKToolUseBlock)
    }
  }
  const toolResultMap = new Map<string, string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const blocks = userMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const rb = b as SDKToolResultBlock
        const raw = userMsg as unknown as Record<string, unknown>
        const structuredResult = raw.toolUseResult ?? raw.tool_use_result
        const text = structuredResult && typeof structuredResult === 'object'
          ? JSON.stringify(structuredResult)
          : extractToolResultText(rb.content)
        if (text) toolResultMap.set(rb.tool_use_id, text)
      }
    }
  }
  const taskActivities: TaskActivity[] = taskBlocks.map((tb) => ({
    toolUseId: tb.id, toolName: tb.name, input: tb.input as Record<string, unknown>,
    result: toolResultMap.get(tb.id), done: true,
  }))
  return { taskActivities, firstTaskIndex }
}

export function buildHistoricalTaskSubjects(allMessages: SDKMessage[]): Map<string, string> {
  const historicalTaskSubjects = new Map<string, string>()
  const globalResultMap = new Map<string, string>()
  const pendingTaskCreates: SDKToolUseBlock[] = []
  for (const msg of allMessages) {
    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      const blocks = userMsg.message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const rb = b as SDKToolResultBlock
          const raw = userMsg as unknown as Record<string, unknown>
          const structuredResult = raw.toolUseResult ?? raw.tool_use_result
          const text = structuredResult && typeof structuredResult === 'object'
            ? JSON.stringify(structuredResult)
            : extractToolResultText(rb.content)
          if (text) globalResultMap.set(rb.tool_use_id, text)
        }
      }
    } else if (msg.type === 'assistant') {
      const aMsg = msg as SDKAssistantMessage
      const blocks = aMsg.message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b.type === 'tool_use' && (b as SDKToolUseBlock).name === 'TaskCreate') {
          pendingTaskCreates.push(b as SDKToolUseBlock)
        }
      }
    }
  }
  for (const tb of pendingTaskCreates) {
    const input = tb.input as Record<string, unknown>
    const subject = typeof input.subject === 'string' ? input.subject
      : typeof input.description === 'string' ? input.description : undefined
    if (!subject) continue
    const resultText = globalResultMap.get(tb.id)
    const parsedResult = parseTaskCreateResult(resultText)
    if (parsedResult?.id) historicalTaskSubjects.set(parsedResult.id, parsedResult.subject ?? subject)
  }
  return historicalTaskSubjects
}

export interface AssistantTurnRendererProps {
  turn: AssistantTurn
  allMessages: SDKMessage[]
  historicalTaskSubjects: Map<string, string>
  basePath?: string
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
  isStreaming?: boolean
  stoppedByUser?: boolean
  sessionModelId?: string
}

export function AssistantTurnRenderer({
  turn, allMessages, historicalTaskSubjects, basePath,
  onFork, onRewind, onRetry, onRetryInNewSession, onCompact,
  isStreaming, stoppedByUser, sessionModelId,
}: AssistantTurnRendererProps): React.ReactElement | null {
  const channels = useAtomValue(channelsAtom)
  const processGroupsKeepExpanded = useAtomValue(agentProcessGroupsKeepExpandedAtom)

  interface EnrichedBlock {
    block: SDKContentBlock
    parentToolUseId?: string | null
  }

  const enrichedBlocks: EnrichedBlock[] = []
  let hasError = false
  let errorContent: SDKAssistantMessage | null = null

  for (const aMsg of turn.assistantMessages) {
    if (aMsg.error) { hasError = true; errorContent = aMsg; continue }
    const blocks = aMsg.message?.content
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        enrichedBlocks.push({ block, parentToolUseId: aMsg.parent_tool_use_id })
      }
    }
  }

  const { durationMs, usage } = extractTurnUsage(turn.turnMessages)

  const isInterruptedTurn = turn.turnMessages.some((m) => {
    if (m.type !== 'result') return false
    const reason = (m as { terminal_reason?: string }).terminal_reason
    return reason === 'aborted_streaming' || reason === 'aborted_tools'
  })
  const showStoppedBadge = stoppedByUser || isInterruptedTurn

  const agentToolIds = new Set<string>()
  for (const eb of enrichedBlocks) {
    if (eb.block.type === 'tool_use') {
      const tu = eb.block as { name: string; id: string }
      if (tu.name === 'Agent' || tu.name === 'Task') agentToolIds.add(tu.id)
    }
  }

  const childBlocksMap = new Map<string, SDKContentBlock[]>()
  const topLevelBlocks: SDKContentBlock[] = []

  for (const eb of enrichedBlocks) {
    if (eb.parentToolUseId && agentToolIds.has(eb.parentToolUseId)) {
      const children = childBlocksMap.get(eb.parentToolUseId) ?? []
      children.push(eb.block)
      childBlocksMap.set(eb.parentToolUseId, children)
    } else {
      topLevelBlocks.push(eb.block)
    }
  }

  const hasTextContent = topLevelBlocks.some(
    (b) => b.type === 'text' && 'text' in b && !!(b as { text: string }).text
  )

  const { taskActivities, firstTaskIndex } = React.useMemo(
    () => buildTaskProgressData(topLevelBlocks, turn.turnMessages),
    [topLevelBlocks, turn.turnMessages],
  )
  const completedToolResultIds = React.useMemo(
    () => buildCompletedToolResultIds(turn.turnMessages),
    [turn.turnMessages],
  )
  const renderItems = React.useMemo(
    () => buildAssistantTurnRenderItems(topLevelBlocks, { isStreaming, completedToolResultIds }),
    [topLevelBlocks, isStreaming, completedToolResultIds],
  )

  if (enrichedBlocks.length === 0 && hasError && errorContent) {
    return <ErrorMessage message={errorContent} onRetry={onRetry} onRetryInNewSession={onRetryInNewSession} onCompact={onCompact} />
  }

  if (enrichedBlocks.length === 0 && !hasError) return null

  const renderTopLevelBlock = (block: SDKContentBlock, i: number): React.ReactNode => {
    if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
      if (i === firstTaskIndex) {
        return <TaskProgressCard key="task-progress-card" activities={taskActivities} streamEnded={!isStreaming} historicalTaskSubjects={historicalTaskSubjects} />
      }
      return null
    }
    const isAgentTool = block.type === 'tool_use' && ((block as { name: string }).name === 'Agent' || (block as { name: string }).name === 'Task')
    const childBlocks = isAgentTool ? childBlocksMap.get((block as { id: string }).id) : undefined
    return (
      <ContentBlock key={i} block={block} allMessages={allMessages} basePath={basePath}
        animate={!!isStreaming} index={i} dimmed={hasTextContent && block.type !== 'text'}
        childBlocks={childBlocks} isStreaming={isStreaming} />
    )
  }

  const renderProcessGroupBlock = (block: SDKContentBlock, i: number): React.ReactNode => {
    const content = renderTopLevelBlock(block, i)
    if (!content) return content
    if (!isStreaming || block.type !== 'text') return content
    return <div key={`process-text-${i}`} className="animate-in fade-in slide-in-from-top-1 duration-300">{content}</div>
  }

  return (
    <Message from="assistant">
      <MessageHeader
        model={turn.model ? resolveModelDisplayName(turn.model, channels) : undefined}
        time={turn.createdAt ? formatMessageTime(turn.createdAt) : undefined}
        logo={<AssistantLogo model={turn.model} />}
      />
      <MessageContent>
        <div className={cn('space-y-2')}>
          {renderItems.map((item) => {
            if (item.type === 'block') return renderTopLevelBlock(item.item.block, item.item.index)
            const groupBlocks = item.items.map((groupItem) => groupItem.block)
            const firstIndex = item.items[0]?.index ?? 0
            return (
              <ProcessBlockGroup key={`process-${firstIndex}`} blocks={groupBlocks} isStreaming={isStreaming} keepExpandedAfterComplete={processGroupsKeepExpanded}>
                {item.items.map((groupItem) => renderProcessGroupBlock(groupItem.block, groupItem.index))}
              </ProcessBlockGroup>
            )
          })}
        </div>
        {hasError && errorContent && topLevelBlocks.length > 0 && (
          <div className="mt-3 text-sm text-destructive">
            {isThinkingSignatureError(errorContent.error?.message)
              ? `${THINKING_SIGNATURE_ERROR_TITLE}：${THINKING_SIGNATURE_ERROR_MESSAGE}`
              : (errorContent.error?.message ?? '未知错误')}
          </div>
        )}
      </MessageContent>
      {!isStreaming && <TurnFileChangesSummary turnMessages={turn.turnMessages} basePath={basePath} />}
      {!isStreaming && (() => {
        const textContent = topLevelBlocks
          .filter((b) => b.type === 'text' && 'text' in b)
          .map((b) => (b as { text: string }).text).join('\n\n')
        const mainlineAssistants = turn.assistantMessages.filter((m) => !m.parent_tool_use_id)
        const lastUuid = mainlineAssistants.length > 0 ? mainlineAssistants[mainlineAssistants.length - 1]?.uuid : undefined
        const hasActions = !!(textContent || (onFork && lastUuid) || (onRewind && lastUuid))
        const hasDuration = durationMs != null
        if (!hasDuration && !hasActions && !showStoppedBadge) return null
        return (
          <MessageActions className="pl-[46px] mt-0.5 min-h-[28px] justify-start">
            {hasDuration && <DurationBadge durationMs={durationMs!} usage={usage} />}
            {textContent && <CopyButton content={textContent} />}
            {onFork && lastUuid && <MessageAction tooltip="从此处分叉" onClick={() => onFork(lastUuid)}><Split className="size-3.5" /></MessageAction>}
            {onRewind && lastUuid && <MessageAction tooltip="回退到此处" onClick={() => onRewind(lastUuid)}><Undo2 className="size-3.5" /></MessageAction>}
            {showStoppedBadge && (
              <Badge variant="outline" className="text-xs text-muted-foreground/70 border-muted-foreground/30 shrink-0">已被用户中断</Badge>
            )}
          </MessageActions>
        )
      })()}
    </Message>
  )
}
