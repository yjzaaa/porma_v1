/**
 * Agent 编排工具函数
 *
 * 从 agent-orchestrator.ts 提取的独立工具函数，无 AgentOrchestrator 类依赖。
 * 包含：API 错误提取、自动重试、SDK 路径解析、prompt 构建等。
 */
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { homedir } from 'node:os'
import type { TypedError, AgentSessionMeta, SDKMessage } from '@proma/shared'
import { isTransientNetworkError } from './error-patterns'
import { getAgentSessionMeta, getAgentSessionSDKMessages } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles } from './agent-workspace-manager'
import { getConfigDirName, getWorkspaceFilesDir } from '../storage/config-paths'

// ===== API 错误提取 =====

/**
 * 从 stderr 中提取 API 错误信息
 */
export function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  const jsonMatch = stderr.match(/(\d{3})\s+(\{[^}]*"error"[^}]*\})/s)
  if (jsonMatch) {
    try {
      const statusCode = parseInt(jsonMatch[1]!)
      const errorObj = JSON.parse(jsonMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch { /* 继续尝试其他模式 */ }
  }

  const apiErrorMatch = stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+(\{.*?\})/s)
  if (apiErrorMatch) {
    try {
      const statusCode = parseInt(apiErrorMatch[1]!)
      const errorObj = JSON.parse(apiErrorMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch { /* 继续尝试其他模式 */ }
  }

  const simpleMatch = stderr.match(/(\d{3})[:\s]+(.+?)(?:\n|$)/i)
  if (simpleMatch) {
    const statusCode = parseInt(simpleMatch[1]!)
    const message = simpleMatch[2]!.trim()
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
}

// ===== 自动重试工具函数 =====

/** 可自动重试的 TypedError 错误码 */
const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',
  'service_error',
  'service_unavailable',
  'network_error',
])

/** 最大自动重试次数 */
export const MAX_AUTO_RETRIES = 25

/** 自动重试累计等待预算（毫秒） */
export const MAX_AUTO_RETRY_WAIT_MS = 5 * 60_000

/** 重试单次延迟上限（毫秒） */
const RETRY_MAX_DELAY_MS = 15_000

/** 判断 typed_error 事件是否可自动重试 */
export function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

/** 判断 catch 块中的 API 错误是否可自动重试 */
export function isAutoRetryableCatchError(
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage?: string,
  stderr?: string,
): boolean {
  if (apiError) {
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  const text = `${rawErrorMessage ?? ''}\n${stderr ?? ''}`
  if (/\b502\b|\b529\b|overloaded/i.test(text)) return true
  if (isTransientNetworkError(rawErrorMessage, stderr)) return true
  return false
}

/** 判断错误是否为 SDK session 不存在 */
export function isSessionNotFoundError(errorMessage: string, stderr?: string): boolean {
  const pattern = /No conversation found.*with session/i
  return pattern.test(errorMessage) || (!!stderr && pattern.test(stderr))
}

/**
 * 计算重试延迟（指数退避 + ±20% jitter）
 */
export function getRetryDelayMs(attempt: number, elapsedRetryDelayMs: number): number {
  const remainingMs = MAX_AUTO_RETRY_WAIT_MS - elapsedRetryDelayMs
  if (remainingMs <= 0) return 0

  const base = Math.min(1000 * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
  const jitter = base * (Math.random() * 0.4 - 0.2)
  return Math.min(remainingMs, Math.max(0, Math.round(base + jitter)))
}

// ===== SDK 路径解析 =====

/**
 * 解析 SDK native CLI binary 路径
 */
export function resolveSDKCliPath(): string {
  const subpkg = `claude-agent-sdk-${process.platform}-${process.arch}`
  const scopedSubpkg = `@anthropic-ai/${subpkg}`
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  let binaryPath: string | null = null

  try {
    const cjsRequire = createRequire(__filename)
    const sdkEntryPath = cjsRequire.resolve('@anthropic-ai/claude-agent-sdk')
    const anthropicDir = dirname(dirname(sdkEntryPath))
    binaryPath = join(anthropicDir, subpkg, binaryName)
    if (!existsSync(binaryPath)) {
      const subpkgPackagePath = cjsRequire.resolve(`${scopedSubpkg}/package.json`)
      binaryPath = join(dirname(subpkgPackagePath), binaryName)
    }
  } catch { /* 忽略 */ }

  if (!binaryPath || !existsSync(binaryPath)) {
    try {
      const sdkEntryPath = require.resolve('@anthropic-ai/claude-agent-sdk')
      const anthropicDir = dirname(dirname(sdkEntryPath))
      binaryPath = join(anthropicDir, subpkg, binaryName)
      if (!existsSync(binaryPath)) {
        const subpkgPackagePath = require.resolve(`${scopedSubpkg}/package.json`)
        binaryPath = join(dirname(subpkgPackagePath), binaryName)
      }
    } catch { /* 忽略 */ }
  }

  if (!binaryPath || !existsSync(binaryPath)) {
    binaryPath = join(__dirname, '..', 'node_modules', '@anthropic-ai', subpkg, binaryName)
  }

  if (app.isPackaged && binaryPath.includes('.asar')) {
    binaryPath = binaryPath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
  }

  return binaryPath
}

// ===== Prompt 构建 =====

/** 最大回填消息条数 */
const MAX_CONTEXT_MESSAGES = 20

/** 单条工具摘要最大字符数 */
const MAX_TOOL_SUMMARY_LENGTH = 200

function extractSDKToolSummary(content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>): string {
  const summaries: string[] = []
  for (const block of content) {
    if (block.type === 'tool_use' && block.name) {
      const input = block.input ?? {}
      const keyParam = input.file_path ?? input.command ?? input.path ?? input.query ?? ''
      const paramStr = keyParam ? `: ${String(keyParam).slice(0, 100)}` : ''
      summaries.push(`[tool: ${block.name}${paramStr}]`)
    }
  }
  if (summaries.length === 0) return ''
  const joined = summaries.join(' ')
  return joined.length > MAX_TOOL_SUMMARY_LENGTH
    ? joined.slice(0, MAX_TOOL_SUMMARY_LENGTH) + '...'
    : joined
}

/**
 * 构建带历史上下文的 prompt
 */
export function buildContextPrompt(sessionId: string, currentUserMessage: string, sessionHint?: { agentCwd: string }): string {
  const allMessages = getAgentSessionSDKMessages(sessionId)
  if (allMessages.length === 0) return currentUserMessage

  const history = allMessages.slice(0, -1)
  if (history.length === 0) return currentUserMessage

  const recent = history.slice(-MAX_CONTEXT_MESSAGES)
  const lines = recent
    .filter((m) => (m.type === 'user' || m.type === 'assistant'))
    .map((m) => {
      const content = (m as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> } }).message?.content
      if (!Array.isArray(content)) return null

      const textParts = content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
      const text = textParts.join('\n')
      if (!text) return null

      let line = `[${m.type}]: ${text}`
      if (m.type === 'assistant') {
        const toolSummary = extractSDKToolSummary(content)
        if (toolSummary) {
          line += `\n  工具活动: ${toolSummary}`
        }
      }
      return line
    })
    .filter(Boolean)

  if (lines.length === 0) return currentUserMessage

  const sessionInfoBlock = sessionHint
    ? `\n<session_info>\nSession ID: ${sessionId}\nSession CWD: ${sessionHint.agentCwd}\nNote: 上方为近期对话摘要。如需更多上下文，可读取 ~/${getConfigDirName()}/agent-sessions/${sessionId}.jsonl 获取完整历史。\n</session_info>\n`
    : ''

  return `<conversation_history>${sessionInfoBlock}\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
}

function escapeContextAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 构建 Session 恢复 prompt
 */
export function buildRecoveryPrompt(
  sessionId: string,
  currentUserMessage: string,
  sessionHint: { agentCwd: string },
): string {
  const meta = getAgentSessionMeta(sessionId)
  const title = meta ? escapeContextAttr(meta.title) : sessionId
  const historyPath = `~/${getConfigDirName()}/agent-sessions/${sessionId}.jsonl`

  const recoveryBlock =
    `<session_recovery>\n` +
    `你正在接续一个已有的 Agent 会话（因模型切换等原因需要重新建立连接）。\n` +
    `当前会话的完整历史记录在下方路径中，请先读取它以恢复上下文，然后继续处理用户的最新请求。\n` +
    `<session id="${sessionId}" title="${title}" cwd="${sessionHint.agentCwd}">\n` +
    `History path: ${historyPath}\n` +
    `</session>\n` +
    `</session_recovery>`

  return `${recoveryBlock}\n\n${currentUserMessage}`
}

/**
 * 构建引用会话 prompt
 */
export function buildReferencedSessionsPrompt(
  currentSessionId: string,
  mentionedSessionIds?: string[],
  workspaceId?: string,
): string {
  const uniqueIds = [...new Set((mentionedSessionIds ?? []).filter(Boolean))]
  if (uniqueIds.length === 0) return ''

  const currentWorkspaceId = workspaceId ?? getAgentSessionMeta(currentSessionId)?.workspaceId
  const sessionBlocks: string[] = []

  for (const referencedSessionId of uniqueIds) {
    if (referencedSessionId === currentSessionId) continue
    const meta = getAgentSessionMeta(referencedSessionId)
    if (!meta || meta.archived) continue
    if (currentWorkspaceId && meta.workspaceId !== currentWorkspaceId) continue

    const title = escapeContextAttr(meta.title)
    const historyPath = `~/${getConfigDirName()}/agent-sessions/${referencedSessionId}.jsonl`
    sessionBlocks.push(
      `<session id="${referencedSessionId}" title="${title}" updatedAt="${meta.updatedAt}">\n` +
      `History path: ${historyPath}\n` +
      '</session>',
    )
  }

  if (sessionBlocks.length === 0) return ''

  return `<referenced_sessions>\n用户在消息中明确引用了以下同工作区 Agent 会话。不要假设这些会话的内容；需要上下文时，请先读取对应的 History path，再基于读取结果继续完成任务。\n${sessionBlocks.join('\n\n')}\n</referenced_sessions>`
}

// ===== 常量 =====

/** 标题生成 Prompt */
export const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。\n\n用户消息：'

/** 标题最大长度 */
export const MAX_TITLE_LENGTH = 20

/** 默认会话标题 */
export const DEFAULT_SESSION_TITLE = '新 Agent 会话'

/** 默认模型 ID */
export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6'

/**
 * 判断模型是否支持 1M context window
 */
export function supports1MContext(modelId: string): boolean {
  const m = modelId.toLowerCase()
  if (m.includes('haiku')) return false
  if (m.includes('claude')) {
    if (m.includes('sonnet-4')) return true
    if (m.includes('opus-4-6') || m.includes('opus-4-7') || m.includes('opus-4-8')) return true
    return false
  }
  if (m.includes('deepseek-v4')) return true
  return false
}

// ===== 目录收集 =====

/**
 * 聚合一次 SDK 调用涉及的所有附加目录
 */
export function collectAttachedDirectories(params: {
  sessionMeta?: AgentSessionMeta
  workspaceSlug?: string
  extraDirs?: string[]
}): string[] {
  const { sessionMeta, workspaceSlug, extraDirs } = params
  const result: string[] = []
  const push = (dir: string | undefined | null) => {
    if (!dir) return
    if (!result.includes(dir)) result.push(dir)
  }

  for (const d of extraDirs ?? []) push(d)
  for (const d of sessionMeta?.attachedDirectories ?? []) push(d)
  for (const file of sessionMeta?.attachedFiles ?? []) push(dirname(file))

  if (workspaceSlug) {
    for (const d of getWorkspaceAttachedDirectories(workspaceSlug)) push(d)
    for (const f of getWorkspaceAttachedFiles(workspaceSlug)) push(dirname(f))
    push(getWorkspaceFilesDir(workspaceSlug))
  }

  return result
}
