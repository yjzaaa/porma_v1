/**
 * Preload 对话管理、消息发送、附件、流式事件订阅（CHAT_IPC_CHANNELS）
 */

import { ipcRenderer } from 'electron'
import { CHAT_IPC_CHANNELS } from '@proma/shared'
import type {
  ConversationMeta,
  ChatMessage,
  ChatSendInput,
  GenerateTitleInput,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  RecentMessagesResult,
  MessageSearchResult,
  StreamChunkEvent,
  StreamReasoningEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  StreamToolActivityEvent,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== 对话管理 =====
  listConversations: () => ipcRenderer.invoke(CHAT_IPC_CHANNELS.LIST_CONVERSATIONS),

  createConversation: (title?: string, modelId?: string, channelId?: string) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_CONVERSATION, title, modelId, channelId),

  getConversationMessages: (id: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_MESSAGES, id),

  getRecentMessages: (id: string, limit: number) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES, id, limit),

  updateConversationTitle: (id: string, title: string) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_TITLE, id, title),

  updateConversationModel: (id: string, modelId: string, channelId: string) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_MODEL, id, modelId, channelId),

  deleteConversation: (id: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_CONVERSATION, id),

  togglePinConversation: (id: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_PIN, id),

  toggleArchiveConversation: (id: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_ARCHIVE, id),

  searchConversationMessages: (query: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEARCH_MESSAGES, query),

  // ===== 教程 =====
  getTutorialContent: () => ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_TUTORIAL_CONTENT),
  createWelcomeConversation: () => ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_WELCOME_CONVERSATION),

  // ===== 消息发送 =====
  sendMessage: (input: ChatSendInput) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEND_MESSAGE, input),
  stopGeneration: (conversationId: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.STOP_GENERATION, conversationId),

  deleteMessage: (conversationId: string, messageId: string) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_MESSAGE, conversationId, messageId),

  truncateMessagesFrom: (conversationId: string, messageId: string, preserveFirstMessageAttachments = false) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM, conversationId, messageId, preserveFirstMessageAttachments),

  updateContextDividers: (conversationId: string, dividers: string[]) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS, conversationId, dividers),

  generateTitle: (input: GenerateTitleInput) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.GENERATE_TITLE, input),

  // ===== 附件管理 =====
  saveAttachment: (input: AttachmentSaveInput) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_ATTACHMENT, input),
  readAttachment: (localPath: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.READ_ATTACHMENT, localPath),
  saveImageAs: (localPath: string, defaultFilename: string) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_IMAGE_AS, localPath, defaultFilename),
  saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) =>
    ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_RESOURCE_FILE_AS, resourceRelativePath, defaultFilename),
  deleteAttachment: (localPath: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_ATTACHMENT, localPath),
  openFileDialog: () => ipcRenderer.invoke(CHAT_IPC_CHANNELS.OPEN_FILE_DIALOG),
  extractAttachmentText: (localPath: string) => ipcRenderer.invoke(CHAT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT, localPath),

  // ===== 流式事件订阅 =====
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => {
    const listener = (_: unknown, event: StreamChunkEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener) }
  },

  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => {
    const listener = (_: unknown, event: StreamReasoningEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_REASONING, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_REASONING, listener) }
  },

  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => {
    const listener = (_: unknown, event: StreamCompleteEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onStreamError: (callback: (event: StreamErrorEvent) => void) => {
    const listener = (_: unknown, event: StreamErrorEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  onStreamToolActivity: (callback: (event: StreamToolActivityEvent) => void) => {
    const listener = (_: unknown, event: StreamToolActivityEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener) }
  },
}

export default api
