/**
 * Preload 快速任务、语音输入、菜单栏、数据迁移、存储管理、自动更新
 */

import { ipcRenderer } from 'electron'
import { QUICK_TASK_IPC_CHANNELS, TRAY_IPC_CHANNELS, VOICE_DICTATION_IPC_CHANNELS, STORAGE_IPC_CHANNELS } from '../types'
import type {
  QuickTaskSubmitInput,
  QuickTaskOpenSessionData,
  VoiceDictationAudioChunkInput,
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationResizeInput,
  VoiceDictationSettings,
  VoiceDictationSettingsUpdate,
  VoiceDictationStartInput,
  VoiceDictationStateEvent,
  VoiceDictationStopInput,
  VoiceDictationTestResult,
  VoiceDictationTranscriptEvent,
  MicPermissionResult,
  TrayCreateSessionData,
  TrayOpenAgentSessionData,
} from '../types'

const api: Record<string, unknown> = {
  // ===== 快速任务 =====
  submitQuickTask: (input: QuickTaskSubmitInput) => ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.SUBMIT, input),
  hideQuickTask: () => ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.HIDE),
  reregisterGlobalShortcuts: () => ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS),

  onQuickTaskFocus: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(QUICK_TASK_IPC_CHANNELS.FOCUS, listener)
    return () => { ipcRenderer.removeListener(QUICK_TASK_IPC_CHANNELS.FOCUS, listener) }
  },

  onQuickTaskOpenSession: (callback: (data: QuickTaskOpenSessionData) => void) => {
    const listener = (_: unknown, data: QuickTaskOpenSessionData): void => callback(data)
    ipcRenderer.on('quick-task:open-session', listener)
    return () => { ipcRenderer.removeListener('quick-task:open-session', listener) }
  },

  // ===== 语音输入 =====
  getVoiceDictationSettings: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS),
  updateVoiceDictationSettings: (updates: VoiceDictationSettingsUpdate) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS, updates),
  testVoiceDictationConnection: (updates?: VoiceDictationSettingsUpdate) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION, updates),
  toggleVoiceDictation: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.TOGGLE),
  activateFromHandsfree: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.ACTIVATE_FROM_HANDSFREE),
  startVoiceDictation: (input: VoiceDictationStartInput) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.START, input),
  sendVoiceDictationAudio: (input: VoiceDictationAudioChunkInput) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO, input),
  stopVoiceDictation: (input: VoiceDictationStopInput) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.STOP, input),
  cancelVoiceDictation: (input: VoiceDictationStopInput) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.CANCEL, input),
  commitVoiceDictation: (input: VoiceDictationCommitInput) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.COMMIT, input),
  hideVoiceDictation: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.HIDE),
  storeHandsfreeBuffer: (data: ArrayBuffer) => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.STORE_HANDSFREE_BUFFER, data),
  getHandsfreeBuffer: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.GET_HANDSFREE_BUFFER),
  resizeVoiceDictation: (input: VoiceDictationResizeInput) =>
    ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.RESIZE, input),

  onVoiceDictationShown: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.SHOWN, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.SHOWN, listener) }
  },

  onVoiceDictationToggleStop: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP, listener) }
  },

  onVoiceDictationTranscript: (callback: (event: VoiceDictationTranscriptEvent) => void) => {
    const listener = (_: unknown, event: VoiceDictationTranscriptEvent): void => callback(event)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, listener) }
  },

  onVoiceDictationState: (callback: (event: VoiceDictationStateEvent) => void) => {
    const listener = (_: unknown, event: VoiceDictationStateEvent): void => callback(event)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.STATE, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.STATE, listener) }
  },

  onVoiceDictationInsertText: (callback: (data: { text: string }) => void) => {
    const listener = (_: unknown, data: { text: string }): void => callback(data)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, listener) }
  },

  onVoiceDictationBroadcastState: (callback: (data: { visible: boolean }) => void) => {
    const listener = (_: unknown, data: { visible: boolean }): void => callback(data)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.BROADCAST_STATE_TO_MAIN, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.BROADCAST_STATE_TO_MAIN, listener) }
  },

  checkMicrophonePermission: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION),
  requestMicrophonePermission: () => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION),
  writeVoiceDictationLog: (logContent: string) => ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.WRITE_LOG, logContent),

  // ===== 菜单栏 =====
  onTrayOpenAgentSession: (callback: (data: TrayOpenAgentSessionData) => void) => {
    const listener = (_: unknown, data: TrayOpenAgentSessionData): void => callback(data)
    ipcRenderer.on(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, listener)
    return () => { ipcRenderer.removeListener(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, listener) }
  },

  onTrayCreateSession: (callback: (data: TrayCreateSessionData) => void) => {
    const listener = (_: unknown, data: TrayCreateSessionData): void => callback(data)
    ipcRenderer.on(TRAY_IPC_CHANNELS.CREATE_SESSION, listener)
    return () => { ipcRenderer.removeListener(TRAY_IPC_CHANNELS.CREATE_SESSION, listener) }
  },

  // ===== 数据迁移 =====
  migrationGetExportPreview: (workspaceId: string) => ipcRenderer.invoke('migration:getExportPreview', workspaceId),
  migrationGetShareExportPreview: () => ipcRenderer.invoke('migration:getShareExportPreview'),
  migrationExport: (options: unknown) => ipcRenderer.invoke('migration:export', options),
  migrationExportV2: (options: unknown) => ipcRenderer.invoke('migration:exportV2', options),
  migrationParseImportFile: (filePath: string) => ipcRenderer.invoke('migration:parseImportFile', filePath),
  migrationConfirmImport: (options: unknown) => ipcRenderer.invoke('migration:confirmImport', options),
  migrationOpenFileDialog: () => ipcRenderer.invoke('migration:openFileDialog'),
  migrationSaveFileDialog: (mode: string) => ipcRenderer.invoke('migration:saveFileDialog', mode),
  migrationCancelImport: (tempDir: string) => ipcRenderer.invoke('migration:cancelImport', tempDir),

  onMigrationOpenImportFile: (callback: (data: { filePath: string }) => void) => {
    const listener = (_: unknown, data: { filePath: string }): void => callback(data)
    ipcRenderer.on('migration:open-import-file', listener)
    return () => { ipcRenderer.removeListener('migration:open-import-file', listener) }
  },

  // ===== 存储管理 =====
  getStorageStats: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.GET_STATS),
  cleanupStorage: (options: unknown) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CLEANUP, options),
  cleanupTempStorage: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CLEANUP_TEMP),
}

export default api
