/**
 * Preload Agent 会话管理、队列消息、权限基础、流式事件订阅（AGENT_IPC_CHANNELS 第一部分）
 */

import { ipcRenderer } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type {
  AgentSessionMeta,
  SDKMessage,
  AgentSendInput,
  AgentStreamEvent,
  AgentStreamCompletePayload,
  AgentGenerateTitleInput,
  MoveSessionToWorkspaceInput,
  ForkSessionInput,
  RewindSessionInput,
  RewindSessionResult,
  AgentMessageSearchResult,
  AgentSessionReferenceSearchInput,
  AgentSessionReferenceSearchResult,
  AgentQueueMessageInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== Agent 会话管理 =====
  listAgentSessions: () => ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSIONS),

  createAgentSession: (title?: string, channelId?: string, workspaceId?: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SESSION, title, channelId, workspaceId),

  getAgentSessionSDKMessages: (id: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SDK_MESSAGES, id),

  updateAgentSessionTitle: (id: string, title: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_TITLE, id, title),

  deleteAgentSession: (id: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SESSION, id),

  migrateChatToAgent: (conversationId: string, agentSessionId: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT, conversationId, agentSessionId),

  togglePinAgentSession: (id: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_PIN, id),

  toggleManualWorkingAgentSession: (id: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_MANUAL_WORKING, id),

  toggleArchiveAgentSession: (id: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE, id),

  searchAgentSessionMessages: (query: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_MESSAGES, query),

  searchAgentSessionReferences: (input: AgentSessionReferenceSearchInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_SESSION_REFERENCES, input),

  moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE, input),

  forkAgentSession: (input: ForkSessionInput) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.FORK_SESSION, input),

  rewindSession: (input: RewindSessionInput) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.REWIND_SESSION, input),

  generateAgentTitle: (input: AgentGenerateTitleInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GENERATE_TITLE, input),

  sendAgentMessage: (input: AgentSendInput) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEND_MESSAGE, input),

  stopAgent: (sessionId: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_AGENT, sessionId),

  queueAgentMessage: (input: AgentQueueMessageInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.QUEUE_MESSAGE, input),

  getTaskOutput: (input: GetTaskOutputInput) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TASK_OUTPUT, input),

  stopTask: (input: StopTaskInput) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_TASK, input),

  // ===== Agent 流式事件订阅 =====
  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => {
    const listener = (_: unknown, event: AgentStreamEvent): void => callback(event)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_EVENT, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_EVENT, listener) }
  },

  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => {
    const listener = (_: unknown, data: AgentStreamCompletePayload): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string; title: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener) }
  },

  // ===== 工作区文件变化通知 =====
  onCapabilitiesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener) }
  },

  onWorkspaceFilesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener) }
  },
}

export default api
