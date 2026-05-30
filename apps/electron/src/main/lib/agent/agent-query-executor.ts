/**
 * AgentQueryExecutor — 查询执行器
 *
 * 管理一次 Agent SDK query 的完整生命周期：自动重试、事件流处理、错误恢复。
 * 从 agent-orchestrator.ts 的 sendMessage 方法中提取的 ~700 行重试/事件循环。
 */
import type { SessionCallbacks } from './agent-orchestrator'
import type {
  AgentProviderAdapter,
  SDKMessage,
  SDKAssistantMessage,
  TypedError,
  RetryAttempt,
} from '@proma/shared'
import type { ClaudeAgentQueryOptions } from '../adapters/claude-agent-adapter'
import {
  isPromptTooLongError,
  isThinkingSignatureError,
  friendlyErrorMessage,
  mapSDKErrorToTypedError,
  extractErrorDetails,
  shouldKeepChannelOpen,
} from '../adapters/claude-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages, appendSDKMessages } from './agent-session-manager'
import {
  extractApiError,
  isAutoRetryableTypedError,
  isAutoRetryableCatchError,
  isSessionNotFoundError,
  getRetryDelayMs,
  buildRecoveryPrompt,
  MAX_AUTO_RETRIES,
  MAX_AUTO_RETRY_WAIT_MS,
} from './agent-orchestrator-utils'
import { permissionService } from './agent-permission-service'

export interface QueryExecutorDeps {
  adapter: AgentProviderAdapter
  eventBus: AgentEventBus
  sessionId: string
  existingSdkSessionId: string | undefined
  contextualMessage: string
  agentCwd: string
  modelId: string
  channelId: string
  userMessage: string
  streamStartedAt: number
  callbacks: SessionCallbacks
  queryOptions: ClaudeAgentQueryOptions
  getActiveSession: () => number | undefined
  deactivateRun: () => void
  isStoppedByUser: () => boolean
  /** 共享状态容器 — orchestrator 的 onSessionId 回调写入，executor 的重试逻辑读取 */
  executorState: ExecutorState
}

export interface ExecutorState {
  capturedSdkSessionId: string | undefined
}

/**
 * 执行一次 Agent query，包含自动重试和事件流处理
 */
export async function executeQuery(deps: QueryExecutorDeps): Promise<void> {
  const { adapter, eventBus, sessionId, contextualMessage, agentCwd, modelId, channelId, userMessage, streamStartedAt, callbacks, queryOptions, getActiveSession, deactivateRun, isStoppedByUser, executorState } = deps
  const stderrChunks: string[] = []

  let existingSdkSessionId = deps.existingSdkSessionId
  let lastRetryableError: string | undefined
  let retryDelayElapsedMs = 0
  let retryAttemptsScheduled = 0
  let retrySucceeded = false
  let skipNextRetryDelay = false
  let thinkingSignatureRecoveryAttempted = false
  let invisibleRecoveryAttempts = 0
  const accumulatedMessages: SDKMessage[] = []
  let capturedResultSubtype: string | undefined
  // capturedSdkSessionId 通过 executorState 共享，由 orchestrator 的 onSessionId 写入

  const canAutoRetry = (attempt: number): boolean =>
    attempt <= MAX_AUTO_RETRIES && retryDelayElapsedMs < MAX_AUTO_RETRY_WAIT_MS

  const canTryThinkingSignatureRecovery = (attempt: number): boolean =>
    !thinkingSignatureRecoveryAttempted &&
    canAutoRetry(attempt) &&
    !!(existingSdkSessionId || executorState.capturedSdkSessionId || queryOptions.resumeSessionId)

  const queryStartedAt = Date.now()

  const persistAccumulated = () => {
    persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
    accumulatedMessages.length = 0
  }

  const completeRun = (messages?: import('@proma/shared').AgentMessage[], opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string }) => {
    deactivateRun()
    callbacks.onComplete(messages, opts)
  }

  const failRun = (error: string, messages?: import('@proma/shared').AgentMessage[], opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string }) => {
    deactivateRun()
    callbacks.onError(error)
    callbacks.onComplete(messages, opts)
  }

  for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      if (skipNextRetryDelay) {
        skipNextRetryDelay = false
      } else {
        const retryAttempt = Math.max(1, attempt - 1 - invisibleRecoveryAttempts)
        const delayMs = getRetryDelayMs(retryAttempt, retryDelayElapsedMs)
        if (delayMs <= 0) break
        retryDelayElapsedMs += delayMs
        retryAttemptsScheduled = retryAttempt
        const delaySec = delayMs / 1000

        eventBus.emit(sessionId, {
          kind: 'proma_event',
          event: { type: 'retry', status: 'starting', attempt: retryAttempt, maxAttempts: MAX_AUTO_RETRIES, delaySeconds: delaySec, reason: lastRetryableError ?? '未知错误' },
        })
        eventBus.emit(sessionId, {
          kind: 'proma_event',
          event: { type: 'retry', status: 'attempt', attemptData: { attempt: retryAttempt, timestamp: Date.now(), reason: lastRetryableError ?? '未知错误', errorMessage: lastRetryableError ?? '', delaySeconds: delaySec } as RetryAttempt },
        })

        await new Promise((r) => setTimeout(r, delayMs))

        if (!getActiveSession()) {
          persistAccumulated()
          completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
          return
        }
      }
    }

    let shouldRetryFromError = false

    try {
      const queryIterable = adapter.query(queryOptions)
      const queryIterator = queryIterable[Symbol.asyncIterator]()

      let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null
      let drainTimeoutPromise: Promise<'drain_timeout'> | null = null
      const RESULT_DRAIN_TIMEOUT_MS = 2_000

      while (true) {
        if (!pendingNext) pendingNext = queryIterator.next()

        const racePromises: Array<Promise<{ kind: string; result: IteratorResult<SDKMessage> | null }>> = [
          pendingNext.then((r) => ({ kind: 'event' as const, result: r })),
        ]
        if (drainTimeoutPromise) {
          racePromises.push(drainTimeoutPromise.then(() => ({ kind: 'drain_timeout' as const, result: null })))
        }

        const raceResult = await Promise.race(racePromises)

        if (raceResult.kind === 'drain_timeout') {
          pendingNext?.catch(() => {})
          pendingNext = null
          queryIterator.return?.(undefined as never).catch(() => {})
          break
        }

        const iterResult = raceResult.result
        if (!iterResult || iterResult.done) break

        pendingNext = null
        const msg = iterResult.value

        // SDK 错误处理
        if (msg.type === 'assistant') {
          const assistantMsg = msg as SDKAssistantMessage
          if (assistantMsg.error) {
            const { detailedMessage, originalError } = extractErrorDetails(assistantMsg as unknown as Parameters<typeof extractErrorDetails>[0])
            let errorCode = assistantMsg.error.errorType || 'unknown_error'
            if (isPromptTooLongError(detailedMessage, originalError)) errorCode = 'prompt_too_long'
            const typedError = mapSDKErrorToTypedError(errorCode, friendlyErrorMessage(detailedMessage), originalError)

            if (isSessionNotFoundError(detailedMessage, originalError) && existingSdkSessionId && canAutoRetry(attempt)) {
              existingSdkSessionId = undefined
              executorState.capturedSdkSessionId = undefined
              lastRetryableError = prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt)
              shouldRetryFromError = true
              break
            }

            if (
              typedError.code === 'thinking_signature_invalid' &&
              canTryThinkingSignatureRecovery(attempt)
            ) {
              thinkingSignatureRecoveryAttempted = true
              invisibleRecoveryAttempts += 1
              existingSdkSessionId = undefined
              executorState.capturedSdkSessionId = undefined
              skipNextRetryDelay = true
              lastRetryableError = prepareResumeFallbackRecovery(
                sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt,
                '检测到 thinking signature 不兼容，清除 sdkSessionId 并切换到上下文回填模式',
                '思考签名不兼容，切换到上下文回填模式',
              )
              stderrChunks.length = 0
              shouldRetryFromError = true
              break
            }

            if (isAutoRetryableTypedError(typedError) && canAutoRetry(attempt)) {
              lastRetryableError = typedError.title ? `${typedError.title}: ${typedError.message}` : typedError.message
              persistAccumulated()
              stderrChunks.length = 0
              shouldRetryFromError = true
              break
            }

            // 不可重试错误
            persistAccumulated()
            handleUnrecoverableError(sessionId, typedError, eventBus, accumulatedMessages, retryAttemptsScheduled, lastRetryableError, completeRun, streamStartedAt)
            return
          }
        }

        // 累积消息
        if (msg.type === 'assistant' || msg.type === 'user' || msg.type === 'result') {
          const msgRecord = msg as Record<string, unknown>
          if (!msgRecord.isReplay) {
            if (msg.type === 'user') {
              const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
              const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
              if (hasToolResult) accumulatedMessages.push(msg)
            } else {
              if (msg.type === 'assistant' && deps.modelId) {
                (msg as Record<string, unknown>)._channelModelId = deps.modelId
              }
              accumulatedMessages.push(msg)
            }
          }
        } else if (msg.type === 'system') {
          const sysMsg = msg as import('@proma/shared').SDKSystemMessage
          if (sysMsg.subtype === 'compact_boundary' || sysMsg.subtype === 'permission_denied') {
            accumulatedMessages.push(msg)
          }
        }

        // Result 处理
        if (msg.type === 'result') {
          capturedResultSubtype = (msg as { subtype?: string }).subtype
          persistAccumulated()
          const resultTerminalReason = (msg as { terminal_reason?: string }).terminal_reason
          const keepChannelOpen = shouldKeepChannelOpen(resultTerminalReason)
          if (!keepChannelOpen && !drainTimeoutPromise) {
            drainTimeoutPromise = new Promise((resolve) =>
              setTimeout(() => resolve('drain_timeout'), RESULT_DRAIN_TIMEOUT_MS),
            )
          }
        }

        // 事件分发
        let shouldEmit = true
        if (msg.type === 'user') {
          const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
          const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
          if (!hasToolResult) shouldEmit = false
        }

        if (shouldEmit) {
          eventBus.emit(sessionId, { kind: 'sdk_message', message: msg })
        }
      }

      if (shouldRetryFromError) continue

      if (retryAttemptsScheduled > 0) {
        eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'retry', status: 'cleared' } })
      }
      retrySucceeded = true

      persistAccumulated()
      try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }

      completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt, resultSubtype: capturedResultSubtype })
      break

    } catch (error) {
      const fullStderr = stderrChunks.join('').trim()
      if (!getActiveSession()) {
        const wasStoppedByUser = deps.isStoppedByUser()
        persistAccumulated()
        try { updateAgentSessionMeta(sessionId, { stoppedByUser: wasStoppedByUser }) } catch { /* 忽略 */ }
        completeRun(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: streamStartedAt })
        return
      }

      const stderrOutput = stderrChunks.join('').trim()
      const apiError = extractApiError(stderrOutput)
      const rawErrorMessage = error instanceof Error ? error.message : ''

      if (isSessionNotFoundError(rawErrorMessage, stderrOutput) && existingSdkSessionId && canAutoRetry(attempt)) {
        existingSdkSessionId = undefined
        executorState.capturedSdkSessionId = undefined
        lastRetryableError = prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt)
        stderrChunks.length = 0
        continue
      }

      if (
        isThinkingSignatureError(apiError?.message ?? '', rawErrorMessage, stderrOutput) &&
        canTryThinkingSignatureRecovery(attempt)
      ) {
        thinkingSignatureRecoveryAttempted = true
        invisibleRecoveryAttempts += 1
        existingSdkSessionId = undefined
        executorState.capturedSdkSessionId = undefined
        skipNextRetryDelay = true
        lastRetryableError = prepareResumeFallbackRecovery(
          sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt,
          '检测到 thinking signature 不兼容，清除 sdkSessionId 并切换到上下文回填模式',
          '思考签名不兼容，切换到上下文回填模式',
        )
        stderrChunks.length = 0
        continue
      }

      if (isAutoRetryableCatchError(apiError, rawErrorMessage, stderrOutput) && canAutoRetry(attempt)) {
        lastRetryableError = apiError
          ? `API Error ${apiError.statusCode}: ${apiError.message}`
          : (error instanceof Error ? error.message : '未知错误')
        persistAccumulated()
        stderrChunks.length = 0
        continue
      }

      // 不可重试
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      if (accumulatedMessages.length > 0) {
        try { persistAccumulated() } catch { /* 忽略 */ }
      }

      let userFacingError: string
      if (apiError) {
        userFacingError = friendlyErrorMessage(`API 错误 (${apiError.statusCode}):\n${apiError.message}`)
      } else {
        userFacingError = friendlyErrorMessage(errorMessage)
      }

      handleCatchError(sessionId, eventBus, userFacingError, apiError, rawErrorMessage, error, stderrOutput, retryAttemptsScheduled, lastRetryableError, failRun, completeRun, streamStartedAt, existingSdkSessionId)
      return
    }
  }

  // 重试耗尽
  if (!retrySucceeded && lastRetryableError) {
    handleRetryExhausted(sessionId, lastRetryableError, retryDelayElapsedMs, retryAttemptsScheduled, eventBus, failRun, streamStartedAt)
  }
}

// ===== 内部辅助 =====

function persistSDKMessages(sessionId: string, accumulatedMessages: SDKMessage[], durationMs?: number): void {
  if (accumulatedMessages.length === 0) return

  const toPersist = accumulatedMessages.filter(
    (m) => m.type === 'assistant' || m.type === 'user' || m.type === 'result'
      || (m.type === 'system' && ['compact_boundary', 'permission_denied'].includes((m as import('@proma/shared').SDKSystemMessage).subtype ?? ''))
  ).filter((m) => {
    if (m.type === 'user') {
      const content = (m as { message?: { content?: Array<{ type: string }> } }).message?.content
      const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
      if (!hasToolResult) return false
    }
    return true
  })

  if (toPersist.length === 0) return

  const now = Date.now()
  const withTimestamps = toPersist.map((m) => {
    const msg = m as Record<string, unknown>
    if (typeof msg._createdAt === 'number') return m
    if (m.type === 'result' && durationMs != null) {
      return { ...m, _createdAt: now, _durationMs: durationMs } as unknown as SDKMessage
    }
    return { ...m, _createdAt: now } as unknown as SDKMessage
  })

  appendSDKMessages(sessionId, withTimestamps)
}

function prepareSessionNotFoundRecovery(
  sessionId: string,
  queryOptions: ClaudeAgentQueryOptions,
  contextualMessage: string,
  agentCwd: string,
  accumulatedMessages: SDKMessage[],
  queryStartedAt: number,
): string {
  return prepareResumeFallbackRecovery(
    sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt,
    '检测到 session-not-found 错误，清除 sdkSessionId 并切换到上下文回填模式',
    'Session 已失效，切换到上下文回填模式',
  )
}

function prepareResumeFallbackRecovery(
  sessionId: string,
  queryOptions: ClaudeAgentQueryOptions,
  contextualMessage: string,
  agentCwd: string,
  accumulatedMessages: SDKMessage[],
  queryStartedAt: number,
  logMessage: string,
  retryReason: string,
): string {
  persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
  accumulatedMessages.length = 0
  try { updateAgentSessionMeta(sessionId, { sdkSessionId: undefined }) } catch { /* 忽略 */ }
  queryOptions.resumeSessionId = undefined
  queryOptions.resumeSessionAt = undefined
  queryOptions.prompt = buildRecoveryPrompt(sessionId, contextualMessage, { agentCwd })
  return retryReason
}

function handleUnrecoverableError(
  sessionId: string,
  typedError: TypedError,
  eventBus: AgentEventBus,
  accumulatedMessages: SDKMessage[],
  retryAttemptsScheduled: number,
  lastRetryableError: string | undefined,
  completeRun: Function,
  streamStartedAt: number,
): void {
  const errorContent = typedError.title ? `${typedError.title}: ${typedError.message}` : typedError.message
  const errorSDKMsg: SDKMessage = {
    type: 'assistant',
    message: { content: [{ type: 'text', text: errorContent }] },
    parent_tool_use_id: null,
    error: { message: typedError.message, errorType: typedError.code },
    _createdAt: Date.now(),
    _errorCode: typedError.code,
    _errorTitle: typedError.title,
    _errorDetails: typedError.details,
    _errorCanRetry: typedError.canRetry,
    _errorActions: typedError.actions,
  } as unknown as SDKMessage
  appendSDKMessages(sessionId, [errorSDKMsg])

  if (retryAttemptsScheduled > 0 && lastRetryableError) {
    eventBus.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled, timestamp: Date.now(), reason: lastRetryableError, errorMessage: typedError.message, delaySeconds: 0 } as RetryAttempt },
    })
  }

  eventBus.emit(sessionId, { kind: 'sdk_message', message: errorSDKMsg })
  try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }
  completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
}

function handleCatchError(
  sessionId: string,
  eventBus: AgentEventBus,
  userFacingError: string,
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage: string,
  error: unknown,
  stderrOutput: string,
  retryAttemptsScheduled: number,
  lastRetryableError: string | undefined,
  failRun: Function,
  completeRun: Function,
  streamStartedAt: number,
  existingSdkSessionId: string | undefined,
): void {
  const isPromptTooLong = isPromptTooLongError(
    userFacingError,
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    stderrOutput,
  )
  const isThinkingSignature = isThinkingSignatureError(
    apiError?.message ?? '', userFacingError, rawErrorMessage,
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    stderrOutput,
  )
  const errorCode = isPromptTooLong ? 'prompt_too_long' : isThinkingSignature ? 'thinking_signature_error' : 'unknown_error'
  const errorTitle = isPromptTooLong ? '上下文过长' : isThinkingSignature ? '思考签名错误' : '执行错误'
  const errorContent = isPromptTooLong
    ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
    : isThinkingSignature
      ? '思考签名错误：模型读取了不兼容的历史思考内容，请重试或开启新会话'
      : userFacingError

  const errMsg: SDKMessage = {
    type: 'assistant',
    message: { content: [{ type: 'text', text: errorContent }] },
    parent_tool_use_id: null,
    error: { message: errorContent, errorType: errorCode },
    _createdAt: Date.now(),
    _errorCode: errorCode,
    _errorTitle: errorTitle,
  } as unknown as SDKMessage

  try { appendSDKMessages(sessionId, [errMsg]) } catch { /* 忽略 */ }

  if (retryAttemptsScheduled > 0 && lastRetryableError) {
    eventBus.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled, timestamp: Date.now(), reason: lastRetryableError, errorMessage: userFacingError, delaySeconds: 0 } as RetryAttempt },
    })
  }

  failRun(userFacingError, getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })

  const shouldClearSession = !apiError || apiError.statusCode >= 500
  if (existingSdkSessionId && shouldClearSession) {
    try { updateAgentSessionMeta(sessionId, { sdkSessionId: undefined }) } catch { /* 忽略 */ }
  }
}

function handleRetryExhausted(
  sessionId: string,
  lastRetryableError: string,
  retryDelayElapsedMs: number,
  retryAttemptsScheduled: number,
  eventBus: AgentEventBus,
  failRun: Function,
  streamStartedAt: number,
): void {
  const retryFailureMessage = retryDelayElapsedMs >= MAX_AUTO_RETRY_WAIT_MS
    ? '重试等待已达到 5 分钟后仍然失败'
    : `重试 ${retryAttemptsScheduled || MAX_AUTO_RETRIES} 次后仍然失败`

  eventBus.emit(sessionId, {
    kind: 'proma_event',
    event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled || MAX_AUTO_RETRIES, timestamp: Date.now(), reason: lastRetryableError, errorMessage: retryFailureMessage, delaySeconds: 0 } as RetryAttempt },
  })

  const retryErrorSDKMsg: SDKMessage = {
    type: 'assistant',
    message: { content: [{ type: 'text', text: `${retryFailureMessage}: ${lastRetryableError}` }] },
    parent_tool_use_id: null,
    error: { message: `${retryFailureMessage}: ${lastRetryableError}`, errorType: 'unknown_error' },
    _createdAt: Date.now(),
    _errorCode: 'unknown_error',
    _errorTitle: '重试失败',
  } as unknown as SDKMessage
  appendSDKMessages(sessionId, [retryErrorSDKMsg])

  failRun(`${retryFailureMessage}: ${lastRetryableError}`, getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
}
