/**
 * IPC Agent 权限、记忆、Chat 工具、AskUser、ExitPlanMode 处理器
 *
 * 后台任务、权限模式切换、记忆配置、Chat 工具管理、交互式问答、计划审批。
 */

import { ipcMain } from 'electron'
import { AGENT_IPC_CHANNELS, MEMORY_IPC_CHANNELS, CHAT_TOOL_IPC_CHANNELS, isPromaPermissionMode } from '@proma/shared'
import type {
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  PromaPermissionMode,
  PermissionResponse,
  AskUserResponse,
  ExitPlanModeResponse,
  MemoryConfig,
  ChatToolInfo,
  ChatToolState,
  ChatToolMeta,
} from '@proma/shared'
import { isAgentSessionActive, updateAgentPermissionMode } from '../lib/agent/agent-service'
import { getAgentSessionMeta, updateAgentSessionMeta } from '../lib/agent/agent-session-manager'
import { permissionService } from '../lib/agent/agent-permission-service'
import { askUserService } from '../lib/agent/agent-ask-user-service'
import { exitPlanService } from '../lib/agent/agent-exit-plan-service'
import { getMemoryConfig, setMemoryConfig } from '../lib/memory-service'
import { getAllToolInfos } from '../lib/chat/chat-tool-registry'
import { updateToolState, updateToolCredentials, getToolCredentials, addCustomTool, deleteCustomTool } from '../lib/chat/chat-tool-config'

export function registerAgentPermissionHandlers(): void {
  // ===== Agent 后台任务管理 =====

  // 获取任务输出（保留接口，供未来扩展）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_TASK_OUTPUT,
    async (_, input: GetTaskOutputInput): Promise<GetTaskOutputResult> => {
      try {
        console.warn('[IPC] GET_TASK_OUTPUT: 当前版本暂未实现，返回空输出')
        return {
          output: '',
          isComplete: false,
        }
      } catch (error) {
        console.error('[IPC] 获取任务输出失败:', error)
        throw error
      }
    }
  )

  // ===== Agent 权限系统 =====

  // 响应权限请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PERMISSION_RESPOND,
    async (event, response: PermissionResponse): Promise<void> => {
      const { requestId, behavior, alwaysAllow } = response
      const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)

      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'proma_event', event: { type: 'permission_resolved', requestId, behavior } },
        })
      }
    }
  )

  // 停止任务
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_TASK,
    async (_, input: StopTaskInput): Promise<void> => {
      try {
        if (input.type === 'shell') {
          console.warn('[IPC] STOP_TASK: Shell 任务停止功能待实现')
        } else {
          console.warn('[IPC] STOP_TASK: Agent 任务暂不支持单独停止')
        }
      } catch (error) {
        console.error('[IPC] 停止任务失败:', error)
        throw error
      }
    }
  )

  // 热切换指定会话的权限模式（运行中生效，不广播）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE,
    async (_, sessionId: string, mode: PromaPermissionMode): Promise<void> => {
      if (!isPromaPermissionMode(mode)) {
        throw new Error(`无效的权限模式: ${mode}`)
      }
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      try {
        updateAgentSessionMeta(sessionId, { permissionMode: mode })
      } catch (err) {
        console.warn(`[IPC] 持久化 session 权限模式失败: sessionId=${sessionId}`, err)
      }
      if (isAgentSessionActive(sessionId)) {
        await updateAgentPermissionMode(sessionId, mode).catch((err) => {
          console.warn(`[IPC] 运行中权限模式切换失败: sessionId=${sessionId}`, err)
          throw err
        })
      }
    }
  )

  // ===== 全局记忆配置 =====

  ipcMain.handle(
    MEMORY_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<MemoryConfig> => {
      return getMemoryConfig()
    }
  )

  ipcMain.handle(
    MEMORY_IPC_CHANNELS.SET_CONFIG,
    async (_, config: MemoryConfig): Promise<void> => {
      setMemoryConfig(config)
    }
  )

  ipcMain.handle(
    MEMORY_IPC_CHANNELS.TEST_CONNECTION,
    async (): Promise<{ success: boolean; message: string }> => {
      const config = getMemoryConfig()
      if (!config.apiKey) {
        return { success: false, message: '请先填写 API Key' }
      }
      try {
        const { searchMemory } = await import('../lib/memos-client')
        const result = await searchMemory(
          { apiKey: config.apiKey, userId: config.userId?.trim() || 'proma-user', baseUrl: config.baseUrl },
          'test connection',
          1,
        )
        return { success: true, message: `连接成功，已检索到 ${result.facts.length} 条事实、${result.preferences.length} 条偏好` }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { success: false, message: `连接失败: ${msg}` }
      }
    }
  )

  // ===== Chat 工具管理 =====

  // 获取所有工具信息
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS,
    async (): Promise<ChatToolInfo[]> => {
      return getAllToolInfos()
    }
  )

  // 获取工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS,
    async (_, toolId: string): Promise<Record<string, string>> => {
      return getToolCredentials(toolId)
    }
  )

  // 更新工具开关状态
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE,
    async (_, toolId: string, state: ChatToolState): Promise<void> => {
      updateToolState(toolId, state)
    }
  )

  // 更新工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS,
    async (_, toolId: string, credentials: Record<string, string>): Promise<void> => {
      updateToolCredentials(toolId, credentials)
    }
  )

  // 创建自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL,
    async (_, meta: ChatToolMeta): Promise<void> => {
      addCustomTool(meta)
    }
  )

  // 删除自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL,
    async (_, toolId: string): Promise<void> => {
      deleteCustomTool(toolId)
    }
  )

  // 测试工具连接
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.TEST_TOOL,
    async (_, toolId: string): Promise<{ success: boolean; message: string }> => {
      if (toolId === 'memory') {
        const config = getMemoryConfig()
        if (!config.apiKey) {
          return { success: false, message: '请先填写 API Key' }
        }
        try {
          const { searchMemory } = await import('../lib/memos-client')
          const result = await searchMemory(
            { apiKey: config.apiKey, userId: config.userId?.trim() || 'proma-user', baseUrl: config.baseUrl },
            'test connection',
            1,
          )
          return { success: true, message: `连接成功，已检索到 ${result.facts.length} 条事实、${result.preferences.length} 条偏好` }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      if (toolId === 'web-search') {
        const { getToolCredentials: getCredentials } = await import('../lib/chat/chat-tool-config')
        const credentials = getCredentials('web-search')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 Tavily API Key' }
        }
        try {
          const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: credentials.apiKey,
              query: 'test connection',
              search_depth: 'basic',
              max_results: 1,
            }),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText}` }
          }
          return { success: true, message: '连接成功，Tavily 搜索 API 可用' }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      if (toolId === 'nano-banana') {
        const { getToolCredentials: getCredentials } = await import('../lib/chat/chat-tool-config')
        const credentials = getCredentials('nano-banana')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 Gemini API Key' }
        }
        try {
          const baseUrl = credentials.baseUrl?.trim() || 'https://generativelanguage.googleapis.com'
          const model = credentials.model?.trim() || 'gemini-3.1-flash-image-preview'
          const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${credentials.apiKey}`
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` }
          }
          return { success: true, message: `连接成功，模型 ${model} 可用` }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      return { success: false, message: `工具 ${toolId} 不支持测试` }
    }
  )

  // ===== AskUserQuestion 交互式问答 =====

  // 响应 AskUser 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ASK_USER_RESPOND,
    async (event, response: AskUserResponse): Promise<void> => {
      const { requestId, answers } = response
      const sessionId = askUserService.respondToAskUser(requestId, answers)

      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'proma_event', event: { type: 'ask_user_resolved', requestId } },
        })
      }
    }
  )

  // ===== ExitPlanMode 计划审批 =====

  // 响应 ExitPlanMode 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND,
    async (event, response: ExitPlanModeResponse): Promise<void> => {
      const result = exitPlanService.respondToExitPlanMode(response)

      if (result) {
        const { sessionId, targetMode } = result

        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'proma_event', event: { type: 'exit_plan_mode_resolved', requestId: response.requestId } },
        })

        if (targetMode) {
          const meta = getAgentSessionMeta(sessionId)
          if (meta) {
            try {
              updateAgentSessionMeta(sessionId, { permissionMode: targetMode })
            } catch (err) {
              console.warn(`[IPC] ExitPlanMode 持久化 session 权限模式失败: sessionId=${sessionId}`, err)
            }
          }
          event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
            sessionId,
            payload: { kind: 'proma_event', event: { type: 'permission_mode_changed', mode: targetMode } },
          })
          console.log(`[IPC] ExitPlanMode 权限模式切换: ${targetMode}`)
        }
      }
    }
  )

  // ===== 待处理请求恢复 =====

  // 获取所有待处理的交互请求快照（渲染进程重载后恢复状态）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS,
    async (): Promise<import('@proma/shared').PendingRequestsSnapshot> => {
      return {
        permissions: permissionService.getPendingRequests(),
        askUsers: askUserService.getPendingRequests(),
        exitPlans: exitPlanService.getPendingRequests(),
      }
    }
  )
}
