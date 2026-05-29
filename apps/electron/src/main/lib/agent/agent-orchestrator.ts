/**
 * AgentOrchestrator — Agent 编排层
 *
 * 从 agent-service.ts 提取的核心业务逻辑，协调流水线阶段和权限策略。
 * 工具函数 → agent-orchestrator-utils.ts
 * 查询执行 → agent-query-executor.ts
 * 流水线阶段 → agent-pipeline-stages.ts
 * 权限策略 → agent-permission-strategy.ts
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { AgentSendInput, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, AgentSessionMeta, SDKMessage, RewindSessionResult, SdkBeta } from '@proma/shared'
import { PROMA_DEFAULT_PERMISSION_MODE, PROMA_PERMISSION_MODE_CONFIG, SAFE_TOOLS } from '@proma/shared'
import type { PromaPermissionMode } from '@proma/shared'
import type { ClaudeAgentQueryOptions } from '../adapters/claude-agent-adapter'
import { getAdapter, fetchTitle } from '@proma/core'
import { getFetchFn } from '../network/proxy-fetch'
import { getEffectiveProxyUrl } from '../network/proxy-settings-service'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, truncateSDKMessages, resolveUserUuidFromSDK, rewindFilesFromSnapshot } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath, getSdkConfigDir } from '../storage/config-paths'
import { getSettings } from '../storage/settings-service'
import { buildSystemPrompt, buildBuiltinAgents } from './agent-prompt-builder'
import { permissionService } from './agent-permission-service'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { getMemoryConfig } from '../memory/memory-service'
import { resolveSDKCliPath, collectAttachedDirectories, supports1MContext, TITLE_PROMPT, MAX_TITLE_LENGTH, DEFAULT_SESSION_TITLE, DEFAULT_MODEL_ID } from './agent-orchestrator-utils'
import { executeQuery } from './agent-query-executor'
import { createPipelineContext, runPreflightStages, stageAcquireSlot, stageResolveSession, stagePersistUserMessage, stageInitSdk, stageEnsureSdkSettings, stageInjectTools, stageBuildPrompt, releaseActiveRun, stageSyncCredentialsToProcessEnv, stageBuildSdkEnv } from './agent-pipeline-stages'
import { createPermissionStrategy, type PermissionStrategyDeps } from './agent-permission-strategy'
import { listChannels, decryptApiKey } from '../channel/channel-manager'

// ===== 类型定义 =====

export interface SessionCallbacks {
  onError: (error: string) => void
  onComplete: (messages?: AgentMessage[], opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string }) => void
  onTitleUpdated: (title: string) => void
  onRunStarted?: (opts: { startedAt: number }) => void
}

// ===== AgentOrchestrator =====

export class AgentOrchestrator {
  private adapter: AgentProviderAdapter
  private eventBus: AgentEventBus
  private activeSessions = new Map<string, number>()
  private queuedMessageUuids = new Map<string, Set<string>>()
  private stoppedBySessions = new Set<string>()
  private sessionPermissionModes = new Map<string, PromaPermissionMode>()

  constructor(adapter: AgentProviderAdapter, eventBus: AgentEventBus) {
    this.adapter = adapter
    this.eventBus = eventBus
  }

  // ===== 标题生成 =====

  async generateTitle(input: AgentGenerateTitleInput): Promise<string | null> {
    const { userMessage, channelId, modelId } = input
    try {
      const channels = listChannels()
      const channel = channels.find((c) => c.id === channelId)
      if (!channel) return null
      const providerAdapter = getAdapter(channel.provider)
      const request = providerAdapter.buildTitleRequest({ baseUrl: channel.baseUrl, apiKey: decryptApiKey(channelId), modelId, prompt: TITLE_PROMPT + userMessage })
      const title = await fetchTitle(request, providerAdapter, getFetchFn(await getEffectiveProxyUrl()))
      return title ? title.trim().replace(/^["'""''「《]+|["'""''」》]+$/g, '').trim().slice(0, MAX_TITLE_LENGTH) || null : null
    } catch { return null }
  }

  private async autoGenerateTitle(sessionId: string, userMessage: string, channelId: string, modelId: string, callbacks: SessionCallbacks): Promise<void> {
    try {
      const meta = getAgentSessionMeta(sessionId)
      if (!meta || meta.title !== DEFAULT_SESSION_TITLE) return
      const title = await this.generateTitle({ userMessage, channelId, modelId })
      if (!title) return
      updateAgentSessionMeta(sessionId, { title })
      callbacks.onTitleUpdated(title)
    } catch { /* 忽略 */ }
  }

  // ===== 核心编排 =====

  async sendMessage(input: AgentSendInput, callbacks: SessionCallbacks): Promise<void> {
    const ctx = createPipelineContext(input.sessionId, input, callbacks, this.adapter, this.eventBus, this.activeSessions, this.sessionPermissionModes, this.stoppedBySessions)

    // S0-S2: 前置检查（并发保护 + Windows Shell + 渠道/API Key）
    if (!(await runPreflightStages(ctx))) return

    // S3: 同步凭证 + 构建 SDK 环境
    stageSyncCredentialsToProcessEnv(ctx)
    await stageBuildSdkEnv(ctx)

    // S4: 抢占会话槽位
    stageAcquireSlot(ctx)

    // S5: SDK Session 解析
    stageResolveSession(ctx)

    // S6: 持久化用户消息
    stagePersistUserMessage(ctx)

    // 权限策略
    const initialPermissionMode: PromaPermissionMode = input.permissionModeOverride ?? PROMA_DEFAULT_PERMISSION_MODE
    this.sessionPermissionModes.set(ctx.sessionId, initialPermissionMode)
    let planModeEntered = initialPermissionMode === 'plan'
    const permissionDeps: PermissionStrategyDeps = {
      sessionId: ctx.sessionId,
      eventBus: ctx.eventBus,
      adapter: this.adapter,
      sessionPermissionModes: this.sessionPermissionModes,
      setPlanModeEntered: () => { planModeEntered = true },
      isPlanModeEntered: () => planModeEntered,
    }
    const permissionStrategy = createPermissionStrategy(permissionDeps, initialPermissionMode)
    permissionStrategy.onEnter()

    try {
      // S7: SDK 初始化 + Binary 检查 + 工作区
      const initResult = await stageInitSdk(ctx)
      if (initResult === false) return

      const { sdk, cliPath } = initResult

      // S8: SDK 项目设置
      stageEnsureSdkSettings(ctx)

      // S9: MCP + 工具注入
      await stageInjectTools(ctx, sdk)
      if (input.customMcpServers) Object.assign(ctx.mcpServers, input.customMcpServers)

      // S10: Prompt 构建
      stageBuildPrompt(ctx)

      // S11: 构建 canUseTool（委托权限策略）
      // 注意：canUseTool 在 bypassPermissions 模式下也必须存在（SDK 要求提供回调），
      // 实际权限决策完全由 PermissionStrategy 接管
      const canUseTool = async (toolName: string, toolInput: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
        // 运行时切换：从 Map 读取当前策略对应的模式
        const currentMode = this.sessionPermissionModes.get(ctx.sessionId) ?? initialPermissionMode
        // 如果模式变了，重新创建策略
        if (currentMode !== permissionStrategy.mode) {
          const newDeps: PermissionStrategyDeps = {
            ...permissionDeps,
            setPlanModeEntered: () => { planModeEntered = true },
            isPlanModeEntered: () => planModeEntered,
          }
          return createPermissionStrategy(newDeps, currentMode).canUseTool(toolName, toolInput, options)
        }
        return permissionStrategy.canUseTool(toolName, toolInput, options)
      }

      // S12: 构建 QueryOptions
      const appSettings = getSettings()
      const claudeAvailable = (input.modelId || DEFAULT_MODEL_ID).toLowerCase().includes('claude')
      const maxTurns = appSettings.agentMaxTurns && appSettings.agentMaxTurns > 0 ? appSettings.agentMaxTurns : undefined
      const systemPromptAppend = buildSystemPrompt({
        workspaceName: ctx.workspace?.name, workspaceSlug: ctx.workspaceSlug, sessionId: ctx.sessionId,
        permissionMode: initialPermissionMode,
        memoryEnabled: (() => { const mc = getMemoryConfig(); return mc.enabled && !!mc.apiKey })(),
        claudeAvailable,
      })

      const queryOptions: ClaudeAgentQueryOptions = {
        sessionId: ctx.sessionId,
        prompt: ctx.finalPrompt,
        model: input.modelId || DEFAULT_MODEL_ID,
        cwd: ctx.agentCwd,
        sdkCliPath: cliPath,
        env: ctx.sdkEnv,
        ...(maxTurns != null && { maxTurns }),
        sdkPermissionMode: PROMA_PERMISSION_MODE_CONFIG[initialPermissionMode].sdkMode,
        allowDangerouslySkipPermissions: !canUseTool,
        canUseTool,
        ...(initialPermissionMode === 'auto' && { allowedTools: [...SAFE_TOOLS] }),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
        resumeSessionId: ctx.existingSdkSessionId,
        ...(ctx.rewindResumeAt && { resumeSessionAt: ctx.rewindResumeAt }),
        ...(Object.keys(ctx.mcpServers).length > 0 && { mcpServers: ctx.mcpServers }),
        ...(ctx.workspaceSlug && { plugins: [{ type: 'local' as const, path: getAgentWorkspacePath(ctx.workspaceSlug) }] }),
        ...(() => { const d = collectAttachedDirectories({ extraDirs: input.additionalDirectories, sessionMeta: ctx.sessionMeta, workspaceSlug: ctx.workspaceSlug }); return d.length > 0 ? { additionalDirectories: d } : {} })(),
        enableFileCheckpointing: true,
        ...(appSettings.agentThinking && { thinking: appSettings.agentThinking }),
        effort: appSettings.agentEffort ?? 'high',
        ...(appSettings.agentMaxBudgetUsd != null && appSettings.agentMaxBudgetUsd > 0 && { maxBudgetUsd: appSettings.agentMaxBudgetUsd }),
        ...(supports1MContext(input.modelId || DEFAULT_MODEL_ID) && { betas: ['context-1m-2025-08-07'] as SdkBeta[] }),
        agents: buildBuiltinAgents(claudeAvailable),
        onStderr: (data: string) => { console.error(`[Agent SDK stderr] ${data}`) },
        onSessionId: (sdkSessionId: string) => {
          capturedSdkSessionId = sdkSessionId
          if (sdkSessionId !== ctx.existingSdkSessionId) {
            try { updateAgentSessionMeta(ctx.sessionId, { sdkSessionId }) } catch { /* 忽略 */ }
          }
          if (!ctx.titleGenerationStarted) {
            ctx.titleGenerationStarted = true
            this.autoGenerateTitle(ctx.sessionId, input.userMessage, input.channelId, ctx.resolvedModel, callbacks).catch(() => {})
          }
        },
        onModelResolved: (model: string) => {
          ctx.resolvedModel = model
          this.eventBus.emit(ctx.sessionId, { kind: 'proma_event', event: { type: 'model_resolved', model } })
        },
      }

      // S13: 执行查询
      await executeQuery({
        adapter: this.adapter, eventBus: this.eventBus,
        sessionId: ctx.sessionId, existingSdkSessionId: ctx.existingSdkSessionId,
        contextualMessage: ctx.contextualMessage, agentCwd: ctx.agentCwd,
        modelId: input.modelId || DEFAULT_MODEL_ID, channelId: input.channelId, userMessage: input.userMessage,
        streamStartedAt: ctx.streamStartedAt, callbacks, queryOptions,
        getActiveSession: () => this.activeSessions.get(ctx.sessionId),
        deactivateRun: () => { if (this.activeSessions.get(ctx.sessionId) !== ctx.runGeneration) return; this.activeSessions.delete(ctx.sessionId); this.sessionPermissionModes.delete(ctx.sessionId) },
        isStoppedByUser: () => this.stoppedBySessions.has(ctx.sessionId),
      })

      // S14: Plan 模式后处理
      if (initialPermissionMode === 'plan' && !this.activeSessions.has(ctx.sessionId)) {
        try { this.eventBus.emit(ctx.sessionId, { kind: 'sdk_message', message: { type: 'prompt_suggestion', suggestion: '请执行该计划' } as unknown as SDKMessage }) } catch { /* 忽略 */ }
      }

    } finally {
      releaseActiveRun(ctx)
      permissionService.clearSessionPending(ctx.sessionId)
      exitPlanService.clearSessionPending(ctx.sessionId)
    }
  }

  // ===== 控制方法 =====

  stop(sessionId: string): void {
    this.activeSessions.delete(sessionId)
    this.sessionPermissionModes.delete(sessionId)
    this.stoppedBySessions.add(sessionId)
    this.queuedMessageUuids.delete(sessionId)
    this.adapter.abort(sessionId)
  }

  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  async updateSessionPermissionMode(sessionId: string, mode: PromaPermissionMode): Promise<void> {
    if (!this.activeSessions.has(sessionId)) return
    this.sessionPermissionModes.set(sessionId, mode)
    if (this.adapter.setPermissionMode) await this.adapter.setPermissionMode(sessionId, mode)
  }

  // ===== 快照回退 =====

  async rewindSession(sessionId: string, assistantMessageUuid: string): Promise<RewindSessionResult> {
    if (this.activeSessions.has(sessionId)) throw new Error('会话正在运行中，请停止后再回退')
    const sessionMeta = getAgentSessionMeta(sessionId)
    if (!sessionMeta?.sdkSessionId) throw new Error('会话没有 SDK session ID，无法回退')
    let projectDir: string | undefined
    let workspaceSlug: string | undefined
    if (sessionMeta.workspaceId) {
      const ws = getAgentWorkspace(sessionMeta.workspaceId)
      if (ws) { workspaceSlug = ws.slug; projectDir = getAgentSessionWorkspacePath(ws.slug, sessionMeta.id) }
    }
    const userMessageUuid = resolveUserUuidFromSDK(sessionMeta.sdkSessionId, assistantMessageUuid, projectDir, sessionMeta.forkSourceSdkSessionId)
    let fileRewindResult: { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number } | undefined
    if (userMessageUuid === '__LAST_TURN__') {
      fileRewindResult = { canRewind: true, filesChanged: [] }
    } else if (userMessageUuid) {
      try {
        let cwd = homedir()
        if (projectDir) cwd = projectDir
        const rewindAttachedDirs = collectAttachedDirectories({ sessionMeta, workspaceSlug })
        fileRewindResult = rewindFilesFromSnapshot(sessionMeta.sdkSessionId, userMessageUuid, cwd, projectDir, sessionMeta.forkSourceSdkSessionId, rewindAttachedDirs)
      } catch (err) {
        fileRewindResult = { canRewind: false, error: err instanceof Error ? err.message : String(err) }
      }
    } else {
      fileRewindResult = { canRewind: false, error: '无法从 SDK session 中解析 user message UUID' }
    }
    const kept = truncateSDKMessages(sessionId, assistantMessageUuid)
    updateAgentSessionMeta(sessionId, { resumeAtMessageUuid: assistantMessageUuid })
    return { remainingMessages: kept.length, fileRewind: fileRewindResult }
  }

  stopAll(): void {
    if (this.activeSessions.size > 0) console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    this.adapter.dispose()
    this.activeSessions.clear()
    this.sessionPermissionModes.clear()
    this.queuedMessageUuids.clear()
  }

  // ===== 队列消息 =====

  async queueMessage(sessionId: string, text: string, _priority?: string, presetUuid?: string, opts?: { interrupt?: boolean }): Promise<string> {
    if (!this.activeSessions.has(sessionId)) throw new Error(`[Agent 编排] 会话未运行，无法追加消息: ${sessionId}`)
    if (!this.adapter.sendQueuedMessage) throw new Error('[Agent 编排] 当前适配器不支持流式追加消息')
    const uuid = presetUuid || randomUUID()
    const uuids = this.queuedMessageUuids.get(sessionId) ?? new Set<string>()
    uuids.add(uuid)
    this.queuedMessageUuids.set(sessionId, uuids)
    const sdkMessage = { type: 'user' as const, message: { role: 'user' as const, content: text }, parent_tool_use_id: null, priority: 'now' as const, uuid, session_id: sessionId }
    try {
      if (opts?.interrupt && this.adapter.interruptQuery) { try { await this.adapter.interruptQuery(sessionId) } catch { /* 忽略 */ } }
      await this.adapter.sendQueuedMessage(sessionId, sdkMessage)
      const persistMsg: SDKMessage = { type: 'user', uuid, message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null, _createdAt: Date.now() } as unknown as SDKMessage
      appendSDKMessages(sessionId, [persistMsg])
    } catch (error) { uuids.delete(uuid); throw error }
    return uuid
  }
}
