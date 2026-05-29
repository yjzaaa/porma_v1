/**
 * Preload Agent 权限、记忆配置、Chat 工具、AskUser、ExitPlanMode
 */

import { ipcRenderer } from 'electron'
import { AGENT_IPC_CHANNELS, MEMORY_IPC_CHANNELS, CHAT_TOOL_IPC_CHANNELS } from '@proma/shared'
import type {
  PermissionResponse,
  PromaPermissionMode,
  MemoryConfig,
  ChatToolInfo,
  ChatToolState,
  ChatToolMeta,
  AskUserResponse,
  ExitPlanModeResponse,
  PendingRequestsSnapshot,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== Agent 权限系统 =====
  respondPermission: (response: PermissionResponse) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.PERMISSION_RESPOND, response),

  updateSessionPermissionMode: (sessionId: string, mode: PromaPermissionMode) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE, sessionId, mode),

  getMemoryConfig: () => ipcRenderer.invoke(MEMORY_IPC_CHANNELS.GET_CONFIG),
  setMemoryConfig: (config: MemoryConfig) => ipcRenderer.invoke(MEMORY_IPC_CHANNELS.SET_CONFIG, config),
  testMemoryConnection: () => ipcRenderer.invoke(MEMORY_IPC_CHANNELS.TEST_CONNECTION),

  // ===== Chat 工具 =====
  getChatTools: () => ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS),
  getChatToolCredentials: (toolId: string) => ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS, toolId),
  updateChatToolState: (toolId: string, state: ChatToolState) =>
    ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE, toolId, state),
  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) =>
    ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS, toolId, credentials),
  createCustomChatTool: (meta: ChatToolMeta) => ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL, meta),
  deleteCustomChatTool: (toolId: string) => ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL, toolId),
  testChatTool: (toolId: string) => ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.TEST_TOOL, toolId),

  onCustomToolChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener)
    return () => { ipcRenderer.removeListener(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener) }
  },

  // ===== AskUser =====
  respondAskUser: (response: AskUserResponse) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.ASK_USER_RESPOND, response),

  // ===== ExitPlanMode =====
  respondExitPlanMode: (response: ExitPlanModeResponse) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND, response),

  getPendingRequests: () => ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS),
}

export default api
