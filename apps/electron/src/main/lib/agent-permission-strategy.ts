/**
 * AgentPermissionStrategy — Agent 权限策略
 *
 * 从 agent-orchestrator.ts 的 sendMessage 提取的权限系统。
 * Strategy 模式：bypassPermissions / plan / auto 三种实现。
 */

import type { AgentProviderAdapter, PromaPermissionMode, PermissionRequest, AskUserRequest, ExitPlanModeRequest } from '@proma/shared'
import type { AgentEventBus } from './agent-event-bus'
import { PROMA_PERMISSION_MODE_CONFIG } from '@proma/shared'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { permissionService } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { exitPlanService, type ExitPlanPermissionResult } from './agent-exit-plan-service'
import { validateToolInput } from './agent-tool-input-validator'
import { estimateTokenCount, WRITE_CONTENT_TOKEN_THRESHOLD } from './agent-tool-token-estimator'

// ===== Plan 模式常量 =====

/** Plan 模式下允许的只读工具（不包含 Write/Edit/Bash 等写操作） */
const PLAN_MODE_ALLOWED_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Agent', 'TodoRead', 'TodoWrite', 'TaskOutput',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'ListMcpResourcesTool', 'ReadMcpResourceTool',
])

const DEFERRED_OR_PROACTIVE_TOOLS = new Set([
  'REPL', 'Workflow', 'ScheduleWakeup', 'Monitor', 'PushNotification',
  'CronCreate', 'CronDelete', 'RemoteTrigger',
])

// ===== PermissionStrategy 接口 =====

export interface PermissionStrategy {
  readonly mode: PromaPermissionMode
  canUseTool(toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult>
  onEnter(): void
  onExit(): void
}

// ===== PermissionStrategyFactory =====

export interface PermissionStrategyDeps {
  sessionId: string
  eventBus: AgentEventBus
  adapter: AgentProviderAdapter
  sessionPermissionModes: Map<string, PromaPermissionMode>
  setPlanModeEntered: () => void
  isPlanModeEntered: () => boolean
}

export function createPermissionStrategy(deps: PermissionStrategyDeps, mode: PromaPermissionMode): PermissionStrategy {
  switch (mode) {
    case 'bypassPermissions':
      return new BypassPermissionStrategy(deps)
    case 'plan':
      return new PlanPermissionStrategy(deps)
    case 'auto':
      return new AutoPermissionStrategy(deps)
    default:
      return new BypassPermissionStrategy(deps)
  }
}

// ===== BypassPermissionStrategy =====

class BypassPermissionStrategy implements PermissionStrategy {
  readonly mode: PromaPermissionMode = 'bypassPermissions'
  private deps: PermissionStrategyDeps

  constructor(deps: PermissionStrategyDeps) {
    this.deps = deps
  }

  async canUseTool(toolName: string, input: Record<string, unknown>, _options: CanUseToolOptions): Promise<PermissionResult> {
    // EnterPlanMode / ExitPlanMode 在完全自动模式下透明放行
    if (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode') {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // 参数校验
    const validationFailure = validateToolInput(toolName, input)
    if (validationFailure) return validationFailure

    return { behavior: 'allow' as const, updatedInput: input }
  }

  onEnter(): void {}
  onExit(): void {}
}

// ===== PlanPermissionStrategy =====

class PlanPermissionStrategy implements PermissionStrategy {
  readonly mode: PromaPermissionMode = 'plan'
  private deps: PermissionStrategyDeps

  constructor(deps: PermissionStrategyDeps) {
    this.deps = deps
  }

  async canUseTool(toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> {
    // ── 参数校验守卫 ──
    const validationFailure = validateToolInput(toolName, input)
    if (validationFailure) return validationFailure

    // ── Write 大文件 token 截断防护 ──
    if (toolName === 'Write' && typeof input.content === 'string') {
      const estimatedTokens = estimateTokenCount(input.content)
      if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
        console.warn(
          `[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${input.content.length}, file=${String(input.file_path)}`,
        )
        return {
          behavior: 'deny' as const,
          message:
            `The content for Write tool (~${estimatedTokens} estimated tokens, ${input.content.length} chars) is too large and may be truncated. ` +
            `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`,
        }
      }
    }

    // EnterPlanMode / ExitPlanMode 处理
    if (toolName === 'EnterPlanMode') {
      this.deps.setPlanModeEntered()
      this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId: this.deps.sessionId } })
      return { behavior: 'allow' as const, updatedInput: input }
    }

    if (toolName === 'ExitPlanMode') {
      if (!this.deps.isPlanModeEntered()) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      const result = await this.handleExitPlanMode(input, options.signal)
      if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
        this.deps.sessionPermissionModes.set(this.deps.sessionId, result.targetMode)
        if (this.deps.adapter.setPermissionMode) {
          this.deps.adapter.setPermissionMode(this.deps.sessionId, result.targetMode).catch((err: unknown) => {
            console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
          })
        }
      }
      return result
    }

    // AskUserQuestion
    if (toolName === 'AskUserQuestion') {
      return askUserService.handleAskUserQuestion(
        this.deps.sessionId, input, options.signal,
        (request: AskUserRequest) => {
          this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'ask_user_request', request } })
        },
      )
    }

    // Plan 模式工具过滤
    if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    if (toolName === 'Write' || toolName === 'Edit') {
      const filePath = typeof input.file_path === 'string' ? input.file_path : ''
      if (filePath.toLowerCase().endsWith('.md')) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (isBashCommandReadOnly(command)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
    }
    if (toolName.startsWith('mcp__')) {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    if (DEFERRED_OR_PROACTIVE_TOOLS.has(toolName)) {
      return { behavior: 'deny' as const, message: '计划模式下不允许启动后台、定时、通知或脚本执行能力，请在计划审批通过后再执行' }
    }
    return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
  }

  onEnter(): void {
    this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId: this.deps.sessionId } })
  }

  onExit(): void {}

  private async handleExitPlanMode(toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> {
    return exitPlanService.handleExitPlanMode(
      this.deps.sessionId,
      toolInput,
      signal,
      (request: ExitPlanModeRequest) => {
        this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'exit_plan_mode_request', request } })
      },
    )
  }
}

// ===== AutoPermissionStrategy =====

class AutoPermissionStrategy implements PermissionStrategy {
  readonly mode: PromaPermissionMode = 'auto'
  private deps: PermissionStrategyDeps

  constructor(deps: PermissionStrategyDeps) {
    this.deps = deps
  }

  async canUseTool(toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> {
    // ── 参数校验守卫 ──
    const validationFailure = validateToolInput(toolName, input)
    if (validationFailure) return validationFailure

    // ── Write 大文件 token 截断防护 ──
    if (toolName === 'Write' && typeof input.content === 'string') {
      const estimatedTokens = estimateTokenCount(input.content)
      if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
        console.warn(
          `[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${input.content.length}, file=${String(input.file_path)}`,
        )
        return {
          behavior: 'deny' as const,
          message:
            `The content for Write tool (~${estimatedTokens} estimated tokens, ${input.content.length} chars) is too large and may be truncated. ` +
            `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`,
        }
      }
    }

    // EnterPlanMode / ExitPlanMode — auto 模式下走审批流程
    if (toolName === 'EnterPlanMode') {
      this.deps.setPlanModeEntered()
      this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId: this.deps.sessionId } })
      return { behavior: 'allow' as const, updatedInput: input }
    }

    if (toolName === 'ExitPlanMode') {
      if (!this.deps.isPlanModeEntered()) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      const result = await this.handleExitPlanMode(input, options.signal)
      if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
        this.deps.sessionPermissionModes.set(this.deps.sessionId, result.targetMode)
        if (this.deps.adapter.setPermissionMode) {
          this.deps.adapter.setPermissionMode(this.deps.sessionId, result.targetMode).catch((err: unknown) => {
            console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
          })
        }
      }
      return result
    }

    // AskUserQuestion
    if (toolName === 'AskUserQuestion') {
      return askUserService.handleAskUserQuestion(
        this.deps.sessionId, input, options.signal,
        (request: AskUserRequest) => {
          this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'ask_user_request', request } })
        },
      )
    }

    // 委托已有的 auto 回调
    const autoCanUseTool = permissionService.createCanUseTool(
      this.deps.sessionId,
      (request: PermissionRequest) => {
        this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'permission_request', request } })
      },
      (sid, toolInput, signal, sendAskUser) => askUserService.handleAskUserQuestion(sid, toolInput, signal, sendAskUser),
      (request: AskUserRequest) => {
        this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'ask_user_request', request } })
      },
    )
    return autoCanUseTool(toolName, input, options)
  }

  onEnter(): void {}
  onExit(): void {}

  private async handleExitPlanMode(toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> {
    return exitPlanService.handleExitPlanMode(
      this.deps.sessionId,
      toolInput,
      signal,
      (request: ExitPlanModeRequest) => {
        this.deps.eventBus.emit(this.deps.sessionId, { kind: 'proma_event', event: { type: 'exit_plan_mode_request', request } })
      },
    )
  }
}

// ===== 辅助函数 =====

/**
 * 判断 Bash 命令是否是只读的（计划模式下安全可执行）
 * 检测写操作特征：文件重定向、破坏性命令、包管理写操作、git 写操作等
 */
function isBashCommandReadOnly(command: string): boolean {
  // 输出重定向：匹配未被数字或 & 前置的 > 符号（排除 2>/dev/null、&> 等 fd 重定向）
  if (/(?<![0-9&])>/.test(command)) return false
  // 破坏性文件操作
  if (/\b(rm|rmdir)\s/.test(command)) return false
  if (/\bsed\s+[^|&;]*-i/.test(command)) return false  // sed -i 原地编辑
  if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
  if (/\b(mv|cp)\s/.test(command)) return false
  if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
  // 包管理器写操作
  if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
  if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
  if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
  // Git 写操作
  if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
  // 进程控制
  if (/\b(kill|killall|pkill)\s/.test(command)) return false
  // 脚本执行（具有潜在副作用，如 node script.js / python main.py）
  if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
  return true
}
