/**
 * AgentPipelineStages — Agent 编排流水线阶段
 *
 * 从 agent-orchestrator.ts 的 sendMessage 提取的步骤函数。
 * 每个阶段接收 PipelineContext，执行一个独立的步骤，修改 context 或提前返回错误。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  AgentSendInput, AgentMessage, AgentProviderAdapter, AgentSessionMeta,
  TypedError, SDKMessage, SdkBeta, ProviderType, AgentWorkspace,
} from '@proma/shared'
import { PROMA_DEFAULT_PERMISSION_MODE, PROMA_PERMISSION_MODE_CONFIG, SAFE_TOOLS } from '@proma/shared'
import type { PromaPermissionMode, PermissionRequest, AskUserRequest } from '@proma/shared'
import type { ClaudeAgentQueryOptions } from '../adapters/claude-agent-adapter'
import { normalizeAnthropicBaseUrlForSdk } from '@proma/core'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceMcpConfig, ensurePluginManifest } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath, getSdkConfigDir } from '../config-paths'
import { getRuntimeStatus } from '../runtime/runtime-init'
import { getSettings } from '../settings-service'
import { buildSystemPrompt, buildDynamicContext, buildBuiltinAgents } from './agent-prompt-builder'
import { getMemoryConfig } from '../memory-service'
import { searchMemory, addMemory, formatSearchResult } from '../memos-client'
import {
  resolveSDKCliPath, buildContextPrompt, buildReferencedSessionsPrompt, collectAttachedDirectories, supports1MContext, DEFAULT_SESSION_TITLE, DEFAULT_MODEL_ID,
} from './agent-orchestrator-utils'
import { AgentEventBus } from './agent-event-bus'
import { executeQuery } from './agent-query-executor'
import type { SessionCallbacks } from './agent-orchestrator'
import { getChannelById, decryptApiKey, listChannels } from '../channel/channel-manager'

// ===== PipelineContext =====

export interface PipelineContext {
  // 输入
  sessionId: string
  input: AgentSendInput
  callbacks: SessionCallbacks
  adapter: AgentProviderAdapter
  eventBus: AgentEventBus
  activeSessions: Map<string, number>
  sessionPermissionModes: Map<string, PromaPermissionMode>
  stoppedBySessions: Set<string>

  // 运行时状态（由阶段填充）
  stderrChunks: string[]
  channel: { id: string; provider: ProviderType; baseUrl?: string } | undefined
  apiKey: string
  sdkEnv: Record<string, string | undefined>
  sessionMeta: AgentSessionMeta | undefined
  existingSdkSessionId: string | undefined
  rewindResumeAt: string | undefined
  agentCwd: string
  workspaceSlug: string | undefined
  workspace: AgentWorkspace | undefined
  resolvedModel: string
  titleGenerationStarted: boolean
  finalPrompt: string
  contextualMessage: string
  queryOptions: ClaudeAgentQueryOptions | undefined
  lastQueryCapturedSdkSession: string | undefined
  mcpServers: Record<string, Record<string, unknown>>
  runGeneration: number
  streamStartedAt: number
}

export function createPipelineContext(
  sessionId: string,
  input: AgentSendInput,
  callbacks: SessionCallbacks,
  adapter: AgentProviderAdapter,
  eventBus: AgentEventBus,
  activeSessions: Map<string, number>,
  sessionPermissionModes: Map<string, PromaPermissionMode>,
  stoppedBySessions: Set<string>,
): PipelineContext {
  const runGeneration = Date.now()
  return {
    sessionId,
    input,
    callbacks,
    adapter,
    eventBus,
    activeSessions,
    sessionPermissionModes,
    stoppedBySessions,
    stderrChunks: [],
    channel: undefined,
    apiKey: '',
    sdkEnv: {},
    sessionMeta: undefined,
    existingSdkSessionId: undefined,
    rewindResumeAt: undefined,
    agentCwd: homedir(),
    workspaceSlug: undefined,
    workspace: undefined,
    resolvedModel: input.modelId || DEFAULT_MODEL_ID,
    titleGenerationStarted: false,
    finalPrompt: '',
    contextualMessage: '',
    queryOptions: undefined,
    lastQueryCapturedSdkSession: undefined,
    mcpServers: {},
    runGeneration,
    streamStartedAt: input.startedAt ?? runGeneration,
  }
}

// ===== 前置检查阶段 =====

/**
 * 前置检查：并发保护、Windows Shell、渠道查找、API Key 解密
 * 不通过则直接 return，不继续流水线
 */
export async function runPreflightStages(ctx: PipelineContext): Promise<boolean> {
  // S0: 并发保护
  if (ctx.activeSessions.has(ctx.sessionId)) {
    console.warn(`[Agent 编排] 会话 ${ctx.sessionId} 正在处理中，拒绝新请求`)
    ctx.callbacks.onError('上一条消息仍在处理中，请稍候再试')
    ctx.callbacks.onComplete([], { startedAt: ctx.streamStartedAt })
    return false
  }

  // S0.5: 清除上一轮中断标记
  try { updateAgentSessionMeta(ctx.sessionId, { stoppedByUser: false }) } catch { /* 会话可能已删除 */ }

  // S1: Windows Shell 检查
  if (process.platform === 'win32') {
    const runtimeStatus = getRuntimeStatus()
    const shellStatus = runtimeStatus?.shell
    if (shellStatus && !shellStatus.gitBash?.available && !shellStatus.wsl?.available) {
      reportPreflightError(ctx, {
        code: 'windows_shell_missing',
        title: 'Windows 环境未就绪',
        message: '需要 Git Bash 或 WSL 才能运行 Agent。建议安装 Git for Windows（自带 Git Bash），安装完成后点「打开环境检测」刷新状态。',
        details: [
          `Git Bash: ${shellStatus.gitBash?.error || '未检测到'}`,
          `WSL: ${shellStatus.wsl?.error || '未检测到'}`,
        ],
        actions: [
          { key: 'e', label: '打开环境检测', action: 'open_environment_check' },
          { key: 'g', label: '去官方下载 Git', action: 'open_external', payload: 'https://git-scm.com/download/win' },
        ],
        canRetry: false,
      })
      return false
    }
  }

  // S2: 获取渠道信息并解密 API Key
  const channel = getChannelById(ctx.input.channelId)
  if (!channel) {
    reportPreflightError(ctx, {
      code: 'channel_not_found',
      title: '渠道不存在',
      message: '当前会话引用的渠道已被删除或不可用，请在设置中重新选择。',
      actions: [{ key: 's', label: '打开渠道路由', action: 'open_channel_settings' }],
      canRetry: false,
    })
    return false
  }
  ctx.channel = channel

  try {
    ctx.apiKey = decryptApiKey(ctx.input.channelId)
  } catch {
    reportPreflightError(ctx, {
      code: 'api_key_decrypt_failed',
      title: 'API Key 解密失败',
      message: '无法解密此渠道的 API Key，可能是系统密钥环异常。请到设置中重新填写 API Key。',
      actions: [{ key: 's', label: '打开渠道路由', action: 'open_channel_settings' }],
      canRetry: false,
    })
    return false
  }

  return true
}

// ===== 环境构建阶段 =====

/**
 * 构建 SDK 环境变量：注入 API Key、Base URL、代理、Shell 配置等
 */
export async function stageBuildSdkEnv(ctx: PipelineContext): Promise<void> {
  const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com'

  // 从 process.env 继承系统变量，清理 ANTHROPIC_ 前缀变量
  const cleanEnv: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('ANTHROPIC_')) {
      cleanEnv[key] = value
    }
  }

  const sdkEnv: Record<string, string | undefined> = {
    ...cleanEnv,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
    CLAUDE_CODE_ENABLE_TASKS: 'true',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CONFIG_DIR: getSdkConfigDir(),
  }

  // 认证方式按 provider 分支
  if (ctx.channel!.provider === 'kimi-coding') {
    sdkEnv.ANTHROPIC_AUTH_TOKEN = ctx.apiKey
    sdkEnv.ANTHROPIC_CUSTOM_HEADERS = 'User-Agent: KimiCLI/1.3'
  } else if (ctx.channel!.provider === 'minimax') {
    sdkEnv.ANTHROPIC_AUTH_TOKEN = ctx.apiKey
    sdkEnv.API_TIMEOUT_MS = '3000000'
    sdkEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  } else {
    sdkEnv.ANTHROPIC_API_KEY = ctx.apiKey
  }

  if (ctx.channel!.baseUrl && ctx.channel!.baseUrl !== DEFAULT_ANTHROPIC_URL) {
    sdkEnv.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrlForSdk(ctx.channel!.baseUrl)
  }

  const proxyUrl = await getEffectiveProxyUrl()
  if (proxyUrl) {
    sdkEnv.HTTPS_PROXY = proxyUrl
    sdkEnv.HTTP_PROXY = proxyUrl
  }

  // Windows Shell 配置
  if (process.platform === 'win32') {
    const runtimeStatus = getRuntimeStatus()
    const shellStatus = runtimeStatus?.shell
    if (shellStatus) {
      if (shellStatus.gitBash?.available && shellStatus.gitBash.path) {
        sdkEnv.CLAUDE_CODE_SHELL = shellStatus.gitBash.path
      } else if (shellStatus.wsl?.available) {
        sdkEnv.CLAUDE_CODE_SHELL = 'wsl'
      } else {
        console.warn('[Agent 编排] Windows 平台未检测到可用的 Shell 环境（Git Bash / WSL）')
      }
      sdkEnv.CLAUDE_BASH_NO_LOGIN = '1'
    }
  }

  // 覆盖未被 sdkEnv 管理的 ANTHROPIC_* 变量
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ANTHROPIC_') && !(key in sdkEnv)) {
      sdkEnv[key] = ''
    }
  }

  ctx.sdkEnv = sdkEnv
}

/**
 * 同步凭证到 process.env
 */
export function stageSyncCredentialsToProcessEnv(ctx: PipelineContext): void {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_CUSTOM_HEADERS

  if (ctx.channel!.provider === 'kimi-coding') {
    process.env.ANTHROPIC_AUTH_TOKEN = ctx.apiKey
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'User-Agent: KimiCLI/1.3'
  } else if (ctx.channel!.provider === 'minimax') {
    process.env.ANTHROPIC_AUTH_TOKEN = ctx.apiKey
  } else {
    process.env.ANTHROPIC_API_KEY = ctx.apiKey
  }
  if (ctx.channel!.baseUrl && ctx.channel!.baseUrl !== 'https://api.anthropic.com') {
    process.env.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrlForSdk(ctx.channel!.baseUrl)
  }
}

// ===== 会话槽位管理阶段 =====

/**
 * 抢占会话槽位，防止并发
 */
export function stageAcquireSlot(ctx: PipelineContext): void {
  ctx.activeSessions.set(ctx.sessionId, ctx.runGeneration)
}

/**
 * 释放会话槽位
 */
export function releaseActiveRun(ctx: PipelineContext): void {
  if (ctx.activeSessions.get(ctx.sessionId) !== ctx.runGeneration) return
  ctx.activeSessions.delete(ctx.sessionId)
  ctx.sessionPermissionModes.delete(ctx.sessionId)
}

// ===== Session 解析阶段 =====

/**
 * 读取 SDK session ID 和回退标记
 */
export function stageResolveSession(ctx: PipelineContext): void {
  ctx.sessionMeta = getAgentSessionMeta(ctx.sessionId)
  ctx.existingSdkSessionId = ctx.sessionMeta?.sdkSessionId

  if (ctx.sessionMeta?.resumeAtMessageUuid) {
    ctx.rewindResumeAt = ctx.sessionMeta.resumeAtMessageUuid
    updateAgentSessionMeta(ctx.sessionId, { resumeAtMessageUuid: undefined })
    console.log(`[Agent 编排] 检测到回退 resume: resumeSessionAt=${ctx.rewindResumeAt}`)
  }

  console.log(`[Agent 编排] Resume 状态: sdkSessionId=${ctx.existingSdkSessionId || '无'}, proma sessionId=${ctx.sessionId}`)
}

// ===== 用户消息持久化阶段 =====

/**
 * 持久化用户消息到 JSONL
 */
export function stagePersistUserMessage(ctx: PipelineContext): void {
  const userSDKMsg: SDKMessage = {
    type: 'user',
    message: { content: [{ type: 'text', text: ctx.input.userMessage }] },
    parent_tool_use_id: null,
    _createdAt: Date.now(),
  } as unknown as SDKMessage
  appendSDKMessages(ctx.sessionId, [userSDKMsg])
  ctx.callbacks.onRunStarted?.({ startedAt: ctx.streamStartedAt })
}

// ===== 工作区解析 + SDK 初始化阶段 =====

export interface WorkspaceInitResult {
  sdk: typeof import('@anthropic-ai/claude-agent-sdk')
  cliPath: string
}

/**
 * 动态导入 SDK + 检查 binary + 确定工作区 cwd
 */
export async function stageInitSdk(ctx: PipelineContext): Promise<WorkspaceInitResult | false> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const cliPath = resolveSDKCliPath()

  if (!existsSync(cliPath)) {
    const subpkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
    console.error(`[Agent 编排] SDK native binary 不存在: ${cliPath}`)
    reportPreflightError(ctx, {
      code: 'claude_binary_not_found',
      title: 'Claude 核心未就绪',
      message: '应用安装包里缺少 Claude Agent SDK 的核心可执行文件（claude.exe）。这通常是打包时未包含当前平台的 SDK 组件导致。请重新下载最新安装包，或提交 issue 告知我们。',
      details: [
        `缺失文件: ${cliPath}`,
        `需要的子包: ${subpkg}`,
      ],
      actions: [
        { key: 'd', label: '下载最新安装包', action: 'open_external', payload: 'https://proma.cool/download' },
        { key: 'i', label: '报告问题', action: 'open_external', payload: 'https://github.com/ErlichLiu/Proma/issues/new' },
      ],
      canRetry: false,
    })
    return false
  }

  console.log(`[Agent 编排] 启动 SDK — binary: ${cliPath}, 模型: ${ctx.input.modelId || DEFAULT_MODEL_ID}, resume: ${ctx.existingSdkSessionId ?? '无'}`)

  ctx.agentCwd = homedir()
  if (ctx.input.workspaceId) {
    const ws = getAgentWorkspace(ctx.input.workspaceId)
    if (ws) {
      ctx.agentCwd = getAgentSessionWorkspacePath(ws.slug, ctx.sessionId)
      ctx.workspaceSlug = ws.slug
      ctx.workspace = ws
      console.log(`[Agent 编排] 使用 session 级别 cwd: ${ctx.agentCwd} (${ws.name}/${ctx.sessionId})`)
      ensurePluginManifest(ws.slug, ws.name)

      if (ctx.existingSdkSessionId) {
        console.log(`[Agent 编排] 将尝试 resume: ${ctx.existingSdkSessionId}`)
      } else {
        console.log(`[Agent 编排] 无 sdkSessionId，将作为新会话启动（回填历史上下文）`)
      }
    }
  }

  return { sdk, cliPath }
}

// ===== SDK 项目设置阶段 =====

/**
 * 确保 .claude/settings.json 包含正确的 SDK 项目设置
 */
export function stageEnsureSdkSettings(ctx: PipelineContext): void {
  const claudeSettingsDir = join(ctx.agentCwd, '.claude')
  if (!existsSync(claudeSettingsDir)) mkdirSync(claudeSettingsDir, { recursive: true })
  const settingsPath = join(claudeSettingsDir, 'settings.json')
  let sdkProjectSettings: Record<string, unknown> = {}
  try {
    sdkProjectSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch { /* 文件不存在或解析失败 */ }
  let needsWrite = false
  if (sdkProjectSettings.plansDirectory !== '.context') {
    sdkProjectSettings.plansDirectory = '.context'
    needsWrite = true
  }
  if (sdkProjectSettings.skipWebFetchPreflight !== true) {
    sdkProjectSettings.skipWebFetchPreflight = true
    needsWrite = true
  }
  if (needsWrite) {
    writeFileSync(settingsPath, JSON.stringify(sdkProjectSettings, null, 2))
  }

  if (ctx.existingSdkSessionId) {
    console.log(`[Agent 编排] 将直接使用已保存的 sdkSessionId 进行 resume: ${ctx.existingSdkSessionId}`)
  }
}

// ===== MCP/工具注入阶段 =====

/**
 * 构建 MCP 服务器配置 + 记忆工具 + 生图工具 + 自定义工具
 */
export async function stageInjectTools(ctx: PipelineContext, sdk: typeof import('@anthropic-ai/claude-agent-sdk')): Promise<void> {
  ctx.mcpServers = buildMcpServers(ctx.workspaceSlug)
  await injectMemoryTools(sdk, ctx.mcpServers, ctx.sessionId, ctx.eventBus)
  await injectNanoBananaTools(sdk, ctx.mcpServers, ctx.sessionId, ctx.agentCwd)

  if (ctx.input.customMcpServers) {
    Object.assign(ctx.mcpServers, ctx.input.customMcpServers)
  }
}

// ===== Prompt 构建阶段 =====

/**
 * 构建最终 prompt（动态上下文 + mentions + 引用会话 + 回填历史）
 */
export function stageBuildPrompt(ctx: PipelineContext): void {
  const dynamicCtx = buildDynamicContext({
    workspaceName: ctx.workspace?.name,
    workspaceSlug: ctx.workspaceSlug,
    agentCwd: ctx.agentCwd,
  })

  let enrichedMessage = ctx.input.userMessage
  const referencedSessionsBlock = buildReferencedSessionsPrompt(ctx.sessionId, ctx.input.mentionedSessionIds, ctx.input.workspaceId)
  if (referencedSessionsBlock) {
    enrichedMessage = `${referencedSessionsBlock}\n\n${enrichedMessage}`
  }
  if (ctx.input.mentionedSkills?.length || ctx.input.mentionedMcpServers?.length) {
    const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
    for (const slug of ctx.input.mentionedSkills ?? []) {
      const qualifiedName = ctx.workspaceSlug ? `proma-workspace-${ctx.workspaceSlug}:${slug}` : slug
      toolLines.push(`- Skill: ${qualifiedName}（请立即调用此 Skill）`)
    }
    for (const name of ctx.input.mentionedMcpServers ?? []) {
      toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
    }
    enrichedMessage = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${ctx.input.userMessage}`
  }

  ctx.contextualMessage = `${dynamicCtx}\n\n${enrichedMessage}`

  const isCompactCommand = ctx.input.userMessage.trim() === '/compact'
  ctx.finalPrompt = isCompactCommand
    ? '/compact'
    : ctx.existingSdkSessionId
      ? ctx.contextualMessage
      : buildContextPrompt(ctx.sessionId, ctx.contextualMessage, { agentCwd: ctx.agentCwd })

  if (ctx.existingSdkSessionId) {
    console.log(`[Agent 编排] 使用 resume 模式，SDK session ID: ${ctx.existingSdkSessionId}`)
  } else if (ctx.finalPrompt !== ctx.contextualMessage) {
    console.log(`[Agent 编排] 无 resume，已回填历史上下文（最近 20 条消息）`)
  }
}

// ===== QueryOptions 构建阶段 =====

/**
 * 构建 ClaudeAgentQueryOptions
 */
export function stageBuildQueryOptions(ctx: PipelineContext, cliPath: string): void {
  const appSettings = getSettings()
  const claudeAvailable = (ctx.input.modelId || DEFAULT_MODEL_ID).toLowerCase().includes('claude')
  const maxTurns = appSettings.agentMaxTurns && appSettings.agentMaxTurns > 0 ? appSettings.agentMaxTurns : undefined

  const initialPermissionMode: PromaPermissionMode = ctx.input.permissionModeOverride ?? PROMA_DEFAULT_PERMISSION_MODE
  ctx.sessionPermissionModes.set(ctx.sessionId, initialPermissionMode)

  const mcpServers = ctx.mcpServers

  // 构建 system prompt（与权限模式无关，统一构建）
  const systemPromptAppend = buildSystemPrompt({
    workspaceName: ctx.workspace?.name,
    workspaceSlug: ctx.workspaceSlug,
    sessionId: ctx.sessionId,
    permissionMode: initialPermissionMode,
    memoryEnabled: (() => { const mc = getMemoryConfig(); return mc.enabled && !!mc.apiKey })(),
    claudeAvailable,
  })

  ctx.queryOptions = {
    sessionId: ctx.sessionId,
    prompt: ctx.finalPrompt,
    model: ctx.input.modelId || DEFAULT_MODEL_ID,
    cwd: ctx.agentCwd,
    sdkCliPath: cliPath,
    env: ctx.sdkEnv,
    ...(maxTurns != null && { maxTurns }),
    sdkPermissionMode: PROMA_PERMISSION_MODE_CONFIG[initialPermissionMode].sdkMode,
    allowDangerouslySkipPermissions: true, // canUseTool 接管所有权限
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: systemPromptAppend,
    },
    resumeSessionId: ctx.existingSdkSessionId,
    ...(ctx.rewindResumeAt && { resumeSessionAt: ctx.rewindResumeAt }),
    ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
    ...(ctx.workspaceSlug && { plugins: [{ type: 'local' as const, path: getAgentWorkspacePath(ctx.workspaceSlug) }] }),
    ...(() => {
      const allDirs = collectAttachedDirectories({
        extraDirs: ctx.input.additionalDirectories,
        sessionMeta: ctx.sessionMeta,
        workspaceSlug: ctx.workspaceSlug,
      })
      return allDirs.length > 0 ? { additionalDirectories: allDirs } : {}
    })(),
    enableFileCheckpointing: true,
    ...(appSettings.agentThinking && { thinking: appSettings.agentThinking }),
    effort: appSettings.agentEffort ?? 'high',
    ...(appSettings.agentMaxBudgetUsd != null && appSettings.agentMaxBudgetUsd > 0 && {
      maxBudgetUsd: appSettings.agentMaxBudgetUsd,
    }),
    ...(supports1MContext(ctx.input.modelId || DEFAULT_MODEL_ID) && {
      betas: ['context-1m-2025-08-07'] as SdkBeta[],
    }),
    agents: buildBuiltinAgents(claudeAvailable),
    onStderr: (data: string) => {
      ctx.stderrChunks.push(data)
      console.error(`[Agent SDK stderr] ${data}`)
    },
    onSessionId: (sdkSessionId: string) => {
      ctx.lastQueryCapturedSdkSession = sdkSessionId
      if (sdkSessionId !== ctx.existingSdkSessionId) {
        try {
          updateAgentSessionMeta(ctx.sessionId, { sdkSessionId })
          const verifyMeta = getAgentSessionMeta(ctx.sessionId)
          console.log(`[Agent 编排] 验证读回: sdkSessionId=${verifyMeta?.sdkSessionId || '空'}`)
        } catch (err) {
          console.error(`[Agent 编排] 保存 SDK session_id 失败:`, err)
        }
      }
    },
    onModelResolved: (model: string) => {
      ctx.resolvedModel = model
      ctx.eventBus.emit(ctx.sessionId, { kind: 'proma_event', event: { type: 'model_resolved', model } })
    },
    onContextWindow: (cw: number) => {
      console.log(`[Agent 编排] 缓存 contextWindow: ${cw}`)
    },
  }
}

// ===== 执行查询阶段 =====

/**
 * 委托 executeQuery 执行查询（含自动重试和事件流处理）
 */
export async function stageExecuteQuery(ctx: PipelineContext): Promise<void> {
  console.log(`[Agent 编排] 开始通过 Adapter 遍历事件流...`)

  await executeQuery({
    adapter: ctx.adapter,
    eventBus: ctx.eventBus,
    sessionId: ctx.sessionId,
    existingSdkSessionId: ctx.existingSdkSessionId,
    contextualMessage: ctx.contextualMessage,
    agentCwd: ctx.agentCwd,
    modelId: ctx.input.modelId || DEFAULT_MODEL_ID,
    channelId: ctx.input.channelId,
    userMessage: ctx.input.userMessage,
    streamStartedAt: ctx.streamStartedAt,
    callbacks: ctx.callbacks,
    queryOptions: ctx.queryOptions!,
    getActiveSession: () => ctx.activeSessions.get(ctx.sessionId),
    deactivateRun: () => {
      if (ctx.activeSessions.get(ctx.sessionId) !== ctx.runGeneration) return
      ctx.activeSessions.delete(ctx.sessionId)
      ctx.sessionPermissionModes.delete(ctx.sessionId)
    },
    isStoppedByUser: () => ctx.stoppedBySessions.has(ctx.sessionId),
  })
}

// ===== Plan 模式后处理 =====

/**
 * Plan 模式：Agent 完成规划后注入"接受计划"建议
 */
export function stagePlanModePostProcess(ctx: PipelineContext, initialPermissionMode: PromaPermissionMode): void {
  if (initialPermissionMode === 'plan' && !ctx.activeSessions.has(ctx.sessionId)) {
    try {
      ctx.eventBus.emit(ctx.sessionId, {
        kind: 'sdk_message',
        message: { type: 'prompt_suggestion', suggestion: '请执行该计划' } as unknown as SDKMessage,
      })
    } catch { /* 会话可能已结束 */ }
  }
}

// ===== Preflight Error 上报 =====

function reportPreflightError(ctx: PipelineContext, typedError: TypedError): void {
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
  try { appendSDKMessages(ctx.sessionId, [errorSDKMsg]) } catch { /* 忽略 */ }
  ctx.callbacks.onError(errorContent)
  ctx.callbacks.onComplete([], { startedAt: ctx.streamStartedAt })
}

// ===== MCP 服务器构建（原 buildMcpServers） =====

function buildMcpServers(workspaceSlug: string | undefined): Record<string, Record<string, unknown>> {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  if (!workspaceSlug) return mcpServers

  const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
  for (const [name, entry] of Object.entries(mcpConfig.servers ?? {})) {
    if (!entry.enabled) continue
    if (name === 'memos-cloud') continue

    if (entry.type === 'stdio' && entry.command) {
      const mergedEnv: Record<string, string> = {
        ...(process.env.PATH && { PATH: process.env.PATH }),
        ...entry.env,
      }
      mcpServers[name] = {
        type: 'stdio',
        command: entry.command,
        ...(entry.args && entry.args.length > 0 && { args: entry.args }),
        ...(Object.keys(mergedEnv).length > 0 && { env: mergedEnv }),
        required: false,
        startup_timeout_sec: entry.timeout ?? 30,
      }
    } else if ((entry.type === 'http' || entry.type === 'sse') && entry.url) {
      mcpServers[name] = {
        type: entry.type,
        url: entry.url,
        ...(entry.headers && Object.keys(entry.headers).length > 0 && { headers: entry.headers }),
        required: false,
      }
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    console.log(`[Agent 编排] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
  }

  return mcpServers
}

// ===== 记忆工具注入（原 injectMemoryTools） =====

async function injectMemoryTools(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  sessionId: string,
  eventBus: AgentEventBus,
): Promise<void> {
  const memoryConfig = getMemoryConfig()
  const memUserId = memoryConfig.userId?.trim() || 'proma-user'
  if (!memoryConfig.enabled || !memoryConfig.apiKey) return

  try {
    const { z } = await import('zod')
    const memosServer = sdk.createSdkMcpServer({
      name: 'mem',
      version: '1.0.0',
      tools: [
        sdk.tool(
          'recall_memory',
          'Search user memories (facts and preferences) from MemOS Cloud. Use this to recall relevant context about the user.',
          { query: z.string().describe('Search query for memory retrieval'), limit: z.number().optional().describe('Max results (default 6)') },
          async (args) => {
            const result = await searchMemory(
              { apiKey: memoryConfig.apiKey, userId: memUserId, baseUrl: memoryConfig.baseUrl },
              args.query,
              args.limit,
            )
            return { content: [{ type: 'text' as const, text: formatSearchResult(result) }] }
          },
          { annotations: { readOnlyHint: true } },
        ),
        sdk.tool(
          'add_memory',
          'Store a conversation message pair into MemOS Cloud for long-term memory. Call this after meaningful exchanges worth remembering.',
          {
            userMessage: z.string().describe('The user message to store'),
            assistantMessage: z.string().optional().describe('The assistant response to store'),
            conversationId: z.string().optional().describe('Conversation ID for grouping'),
            tags: z.array(z.string()).optional().describe('Tags for categorization'),
          },
          async (args) => {
            await addMemory(
              { apiKey: memoryConfig.apiKey, userId: memUserId, baseUrl: memoryConfig.baseUrl },
              args,
            )
            return { content: [{ type: 'text' as const, text: 'Memory stored successfully.' }] }
          },
        ),
      ],
    })
    mcpServers['mem'] = memosServer as unknown as Record<string, unknown>
  } catch (err) {
    console.error(`[Agent 编排] 注入记忆工具失败:`, err)
  }
}

// ===== Nano Banana 工具注入（原 injectNanoBananaTools） =====

async function injectNanoBananaTools(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  sessionId: string,
  agentCwd?: string,
): Promise<void> {
  try {
    const { injectNanoBananaMcpServer } = await import('../chat-tools/nano-banana-mcp')
    await injectNanoBananaMcpServer(sdk, mcpServers, sessionId, agentCwd)
  } catch (err) {
    console.error(`[Agent 编排] 注入 Nano Banana MCP 失败:`, err)
  }
}
