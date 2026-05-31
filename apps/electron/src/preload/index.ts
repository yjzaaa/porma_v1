/**
 * Preload 主入口
 *
 * 从各子模块聚合 API 并通过 contextBridge 暴露给渲染进程。
 */
import { contextBridge, ipcRenderer } from 'electron'

import runtimeApi from './runtime'
import channelsApi from './channels'
import chatApi from './chat'
import userSettingsApi from './user-settings'
import agentSessionsApi from './agent-sessions'
import agentWorkspaceApi from './agent-workspace'
import agentPermissionsApi from './agent-permissions'
import agentFilesApi from './agent-files'
import systemPromptApi from './system-prompt'
import feishuApi from './feishu'
import integrationsApi from './integrations'
import miscApi from './misc'

const updaterApi: Record<string, unknown> = {
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    onStatusChanged: (callback: (status: Record<string, unknown>) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Record<string, unknown>): void => callback(status)
      ipcRenderer.on('updater:status-changed', listener)
      return () => { ipcRenderer.removeListener('updater:status-changed', listener) }
    },
    quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  },
}

const electronAPI: Record<string, unknown> = Object.assign(
  {},
  runtimeApi,
  channelsApi,
  chatApi,
  userSettingsApi,
  agentSessionsApi,
  agentWorkspaceApi,
  agentPermissionsApi,
  agentFilesApi,
  systemPromptApi,
  feishuApi,
  integrationsApi,
  miscApi,
  updaterApi,
)

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

/**
 * ElectronAPI 接口 — 暴露给渲染进程的方法签名
 *
 * 渲染进程通过 window.electronAPI 调用。
 * 保持此接口与所有 preload 子模块的导出一致。
 */
export interface ElectronAPI {
  getRuntimeStatus: () => Promise<import('@proma/shared').RuntimeStatus | null>
  reinitRuntime: () => Promise<import('@proma/shared').RuntimeStatus>
  getGitRepoStatus: (dirPath: string) => Promise<import('@proma/shared').GitRepoStatus | null>
  getUnstagedChanges: (dirPath: string, sessionPath?: string, workspaceFilesPath?: string, extraPaths?: string[], sessionId?: string) => Promise<import('@proma/shared').UnstagedChangesResult>
  getFileDiff: (input: import('@proma/shared').GetFileDiffInput) => Promise<string>
  getUntrackedContent: (input: import('@proma/shared').GetFileDiffInput) => Promise<string>
  revertFile: (input: import('@proma/shared').RevertFileInput) => Promise<void>
  getDiffContents: (input: import('@proma/shared').GetFileDiffInput) => Promise<{ oldContent: string; newContent: string } | null>
  openDetachedPreview: (input: import('@proma/shared').DetachedPreviewWindowInput) => Promise<string | null>
  getDetachedPreviewData: (previewId: string) => Promise<import('@proma/shared').DetachedPreviewWindowData | null>
  openExternal: (url: string) => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  onWindowResize: (callback: () => void) => () => void
  systemOpenFile: (filePath: string, appName?: string, access?: import('@proma/shared').FileAccessOptions) => Promise<void>
  scanEditors: () => Promise<import('@proma/shared').EditorApp[]>
  getDefaultAppForFile: (filePath: string) => Promise<import('@proma/shared').DefaultAppInfo | null>
  screenshotCapture: (input: { html: string; isDark: boolean; width?: number; mode: 'clipboard' | 'file'; css?: string; themeClass?: string }) => Promise<{ success: boolean; message: string; filePath?: string }>
  getPathForFile: (file: File) => string

  listChannels: () => Promise<import('@proma/shared').Channel[]>
  createChannel: (input: import('@proma/shared').ChannelCreateInput) => Promise<import('@proma/shared').Channel>
  updateChannel: (id: string, input: import('@proma/shared').ChannelUpdateInput) => Promise<import('@proma/shared').Channel>
  deleteChannel: (id: string) => Promise<void>
  decryptApiKey: (channelId: string) => Promise<string>
  testChannel: (channelId: string) => Promise<import('@proma/shared').ChannelTestResult>
  testChannelDirect: (input: import('@proma/shared').FetchModelsInput) => Promise<import('@proma/shared').ChannelTestResult>
  fetchModels: (input: import('@proma/shared').FetchModelsInput) => Promise<import('@proma/shared').FetchModelsResult>
  refreshModels: () => Promise<import('@proma/shared').Channel[]>

  listConversations: () => Promise<import('@proma/shared').ConversationMeta[]>
  createConversation: (title?: string, modelId?: string, channelId?: string) => Promise<import('@proma/shared').ConversationMeta>
  getConversationMessages: (id: string) => Promise<import('@proma/shared').ChatMessage[]>
  getRecentMessages: (id: string, limit: number) => Promise<import('@proma/shared').RecentMessagesResult>
  updateConversationTitle: (id: string, title: string) => Promise<import('@proma/shared').ConversationMeta>
  updateConversationModel: (id: string, modelId: string, channelId: string) => Promise<import('@proma/shared').ConversationMeta>
  deleteConversation: (id: string) => Promise<void>
  togglePinConversation: (id: string) => Promise<import('@proma/shared').ConversationMeta>
  toggleArchiveConversation: (id: string) => Promise<import('@proma/shared').ConversationMeta>
  searchConversationMessages: (query: string) => Promise<import('@proma/shared').MessageSearchResult[]>
  getTutorialContent: () => Promise<string | null>
  createWelcomeConversation: () => Promise<import('@proma/shared').ConversationMeta | null>
  sendMessage: (input: import('@proma/shared').ChatSendInput) => Promise<void>
  stopGeneration: (conversationId: string) => Promise<void>
  deleteMessage: (conversationId: string, messageId: string) => Promise<import('@proma/shared').ChatMessage[]>
  truncateMessagesFrom: (conversationId: string, messageId: string, preserveFirstMessageAttachments?: boolean) => Promise<import('@proma/shared').ChatMessage[]>
  updateContextDividers: (conversationId: string, dividers: string[]) => Promise<import('@proma/shared').ConversationMeta>
  generateTitle: (input: import('@proma/shared').GenerateTitleInput) => Promise<string | null>
  saveAttachment: (input: import('@proma/shared').AttachmentSaveInput) => Promise<import('@proma/shared').AttachmentSaveResult>
  readAttachment: (localPath: string) => Promise<string>
  saveImageAs: (localPath: string, defaultFilename: string) => Promise<boolean>
  saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) => Promise<boolean>
  deleteAttachment: (localPath: string) => Promise<void>
  openFileDialog: () => Promise<import('@proma/shared').FileDialogResult>
  extractAttachmentText: (localPath: string) => Promise<string>
  onStreamChunk: (callback: (event: import('@proma/shared').StreamChunkEvent) => void) => () => void
  onStreamReasoning: (callback: (event: import('@proma/shared').StreamReasoningEvent) => void) => () => void
  onStreamComplete: (callback: (event: import('@proma/shared').StreamCompleteEvent) => void) => () => void
  onStreamError: (callback: (event: import('@proma/shared').StreamErrorEvent) => void) => () => void
  onStreamToolActivity: (callback: (event: import('@proma/shared').StreamToolActivityEvent) => void) => () => void

  getUserProfile: () => Promise<import('../types').UserProfile>
  updateUserProfile: (updates: Partial<import('../types').UserProfile>) => Promise<import('../types').UserProfile>
  getSettings: () => Promise<import('../types').AppSettings>
  updateSettings: (updates: Partial<import('../types').AppSettings>) => Promise<import('../types').AppSettings>
  updateSettingsSync: (updates: Partial<import('../types').AppSettings>) => boolean
  getSystemTheme: () => Promise<boolean>
  onSystemThemeChanged: (callback: (isDark: boolean) => void) => () => void
  onThemeSettingsChanged: (callback: (payload: { themeMode: string; themeStyle: string }) => void) => () => void
  loadScratchPad: () => Promise<string>
  saveScratchPad: (content: string) => Promise<boolean>
  saveScratchPadSync: (content: string) => boolean
  exportScratchPad: (markdown: string, dirPath: string, filename: string) => Promise<string>
  chooseExportPath: (defaultName: string) => Promise<string | null>
  setAppIcon: (variantId: string) => Promise<boolean>
  setDockBadgeCount: (count: number) => Promise<boolean>

  checkEnvironment: () => Promise<import('@proma/shared').EnvironmentCheckResult>
  fetchInstallerManifest: () => Promise<import('@proma/shared').InstallerManifest>
  downloadInstaller: (req: import('@proma/shared').InstallerDownloadRequest) => Promise<import('@proma/shared').InstallerDownloadResult>
  cancelInstallerDownload: (key: string) => Promise<boolean>
  launchInstaller: (filePath: string) => Promise<void>
  onInstallerProgress: (callback: (payload: import('@proma/shared').InstallerProgressPayload) => void) => () => void
  getProxySettings: () => Promise<import('@proma/shared').ProxyConfig>
  updateProxySettings: (config: import('@proma/shared').ProxyConfig) => Promise<void>
  detectSystemProxy: () => Promise<import('@proma/shared').SystemProxyDetectResult>

  listAgentSessions: () => Promise<import('@proma/shared').AgentSessionMeta[]>
  createAgentSession: (title?: string, channelId?: string, workspaceId?: string) => Promise<import('@proma/shared').AgentSessionMeta>
  getAgentSessionSDKMessages: (id: string) => Promise<import('@proma/shared').SDKMessage[]>
  updateAgentSessionTitle: (id: string, title: string) => Promise<import('@proma/shared').AgentSessionMeta>
  deleteAgentSession: (id: string) => Promise<void>
  migrateChatToAgent: (conversationId: string, agentSessionId: string) => Promise<void>
  togglePinAgentSession: (id: string) => Promise<import('@proma/shared').AgentSessionMeta>
  toggleManualWorkingAgentSession: (id: string) => Promise<import('@proma/shared').AgentSessionMeta>
  toggleArchiveAgentSession: (id: string) => Promise<import('@proma/shared').AgentSessionMeta>
  searchAgentSessionMessages: (query: string) => Promise<import('@proma/shared').AgentMessageSearchResult[]>
  searchAgentSessionReferences: (input: import('@proma/shared').AgentSessionReferenceSearchInput) => Promise<import('@proma/shared').AgentSessionReferenceSearchResult[]>
  moveAgentSessionToWorkspace: (input: import('@proma/shared').MoveSessionToWorkspaceInput) => Promise<import('@proma/shared').AgentSessionMeta>
  forkAgentSession: (input: import('@proma/shared').ForkSessionInput) => Promise<import('@proma/shared').AgentSessionMeta>
  rewindSession: (input: import('@proma/shared').RewindSessionInput) => Promise<import('@proma/shared').RewindSessionResult>
  generateAgentTitle: (input: import('@proma/shared').AgentGenerateTitleInput) => Promise<string | null>
  sendAgentMessage: (input: import('@proma/shared').AgentSendInput) => Promise<void>
  stopAgent: (sessionId: string) => Promise<void>
  queueAgentMessage: (input: import('@proma/shared').AgentQueueMessageInput) => Promise<string>
  getTaskOutput: (input: import('@proma/shared').GetTaskOutputInput) => Promise<import('@proma/shared').GetTaskOutputResult>
  stopTask: (input: import('@proma/shared').StopTaskInput) => Promise<void>
  onAgentStreamEvent: (callback: (event: import('@proma/shared').AgentStreamEvent) => void) => () => void
  onAgentStreamComplete: (callback: (data: import('@proma/shared').AgentStreamCompletePayload) => void) => () => void
  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void
  onCapabilitiesChanged: (callback: () => void) => () => void
  onWorkspaceFilesChanged: (callback: () => void) => () => void

  listAgentWorkspaces: () => Promise<import('@proma/shared').AgentWorkspace[]>
  createAgentWorkspace: (name: string) => Promise<import('@proma/shared').AgentWorkspace>
  updateAgentWorkspace: (id: string, updates: { name: string }) => Promise<import('@proma/shared').AgentWorkspace>
  deleteAgentWorkspace: (id: string) => Promise<void>
  reorderAgentWorkspaces: (orderedIds: string[]) => Promise<import('@proma/shared').AgentWorkspace[]>
  getWorkspaceCapabilities: (workspaceSlug: string) => Promise<import('@proma/shared').WorkspaceCapabilities>
  getWorkspaceMcpConfig: (workspaceSlug: string) => Promise<import('@proma/shared').WorkspaceMcpConfig>
  saveWorkspaceMcpConfig: (workspaceSlug: string, config: import('@proma/shared').WorkspaceMcpConfig) => Promise<void>
  testMcpServer: (name: string, entry: import('@proma/shared').McpServerEntry) => Promise<{ success: boolean; message: string }>
  getWorkspaceSkills: (workspaceSlug: string) => Promise<import('@proma/shared').SkillMeta[]>
  getWorkspaceSkillsDir: (workspaceSlug: string) => Promise<string>
  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => Promise<void>
  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => Promise<void>
  getOtherWorkspaceSkills: (currentSlug: string) => Promise<import('@proma/shared').OtherWorkspaceSkillsGroup[]>
  importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) => Promise<import('@proma/shared').SkillMeta>
  updateSkillFromSource: (targetSlug: string, skillSlug: string) => Promise<import('@proma/shared').SkillMeta>
  readSkillContent: (workspaceSlug: string, skillSlug: string) => Promise<string>
  writeSkillContent: (workspaceSlug: string, skillSlug: string, content: string) => Promise<void>
  listSkillFiles: (workspaceSlug: string, skillSlug: string) => Promise<import('@proma/shared').SkillFileNode[]>
  readSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string) => Promise<import('@proma/shared').SkillFileContent>
  writeSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string, content: string) => Promise<void>
  createSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory') => Promise<void>
  deleteSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string) => Promise<void>
  renameSkillEntry: (workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string) => Promise<void>

  respondPermission: (response: import('@proma/shared').PermissionResponse) => Promise<void>
  updateSessionPermissionMode: (sessionId: string, mode: import('@proma/shared').PromaPermissionMode) => Promise<void>
  getMemoryConfig: () => Promise<import('@proma/shared').MemoryConfig>
  setMemoryConfig: (config: import('@proma/shared').MemoryConfig) => Promise<void>
  testMemoryConnection: () => Promise<{ success: boolean; message: string }>
  getChatTools: () => Promise<import('@proma/shared').ChatToolInfo[]>
  getChatToolCredentials: (toolId: string) => Promise<Record<string, string>>
  updateChatToolState: (toolId: string, state: import('@proma/shared').ChatToolState) => Promise<void>
  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => Promise<void>
  createCustomChatTool: (meta: import('@proma/shared').ChatToolMeta) => Promise<void>
  deleteCustomChatTool: (toolId: string) => Promise<void>
  testChatTool: (toolId: string) => Promise<{ success: boolean; message: string }>
  onCustomToolChanged: (callback: () => void) => () => void
  respondAskUser: (response: import('@proma/shared').AskUserResponse) => Promise<void>
  respondExitPlanMode: (response: import('@proma/shared').ExitPlanModeResponse) => Promise<void>
  getPendingRequests: () => Promise<import('@proma/shared').PendingRequestsSnapshot>

  saveFilesToAgentSession: (input: import('@proma/shared').AgentSaveFilesInput) => Promise<import('@proma/shared').AgentSavedFile[]>
  saveFilesToWorkspaceFiles: (input: import('@proma/shared').AgentSaveWorkspaceFilesInput) => Promise<import('@proma/shared').AgentSavedFile[]>
  getWorkspaceFilesPath: (workspaceSlug: string) => Promise<string>
  openFolderDialog: () => Promise<{ path: string; name: string } | null>
  attachDirectory: (input: import('@proma/shared').AgentAttachDirectoryInput) => Promise<string[]>
  detachDirectory: (input: import('@proma/shared').AgentAttachDirectoryInput) => Promise<string[]>
  attachFile: (input: import('@proma/shared').AgentAttachFileInput) => Promise<string[]>
  detachFile: (input: import('@proma/shared').AgentAttachFileInput) => Promise<string[]>
  attachWorkspaceDirectory: (input: import('@proma/shared').WorkspaceAttachDirectoryInput) => Promise<string[]>
  detachWorkspaceDirectory: (input: import('@proma/shared').WorkspaceAttachDirectoryInput) => Promise<string[]>
  attachWorkspaceFile: (input: import('@proma/shared').WorkspaceAttachFileInput) => Promise<string[]>
  detachWorkspaceFile: (input: import('@proma/shared').WorkspaceAttachFileInput) => Promise<string[]>
  getWorkspaceDirectories: (workspaceSlug: string) => Promise<string[]>
  getWorkspaceAttachedFiles: (workspaceSlug: string) => Promise<string[]>
  getAgentSessionPath: (workspaceId: string, sessionId: string) => Promise<string | null>
  listDirectory: (dirPath: string) => Promise<import('@proma/shared').FileEntry[]>
  deleteFile: (filePath: string) => Promise<void>
  openFile: (filePath: string) => Promise<void>
  writeClipboardPreview: (filename: string, content: string) => Promise<string>
  showInFolder: (filePath: string) => Promise<void>
  resolveAndReadFile: (filePath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<{ resolvedPath: string; content: string } | null>
  writeTextFile: (filePath: string, content: string, access?: import('@proma/shared').FileAccessOptions) => Promise<boolean>
  resolveFilePath: (filePath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<import('@proma/shared').ResolvedFileUrl | null>
  preparePdfPreview: (filePath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<{ tmpHtmlUrl: string } | null>
  readBinaryBase64: (filePath: string, access?: import('@proma/shared').FileAccessOptions, maxSize?: number) => Promise<string | null>
  docxToHtml: (filePath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<{ resolvedPath: string; html: string } | null>
  officeToHtml: (filePath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<import('@proma/shared').OfficePreviewResult | null>
  renameFile: (filePath: string, newName: string) => Promise<void>
  moveFile: (filePath: string, targetDir: string) => Promise<void>
  listAttachedDirectory: (dirPath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<import('@proma/shared').FileEntry[]>
  readAttachedFile: (filePath: string, sessionId?: string, workspaceSlug?: string) => Promise<string>
  showAttachedInFolder: (filePath: string, access?: import('@proma/shared').FileAccessOptions) => Promise<void>
  renameAttachedFile: (filePath: string, newName: string, access?: import('@proma/shared').FileAccessOptions) => Promise<void>
  moveAttachedFile: (filePath: string, targetDir: string, access?: import('@proma/shared').FileAccessOptions) => Promise<void>
  checkPathsType: (paths: string[]) => Promise<{ directories: string[]; files: string[] }>
  searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[], sessionPaths?: string[]) => Promise<import('@proma/shared').FileSearchResult>

  getSystemPromptConfig: () => Promise<import('@proma/shared').SystemPromptConfig>
  createSystemPrompt: (input: import('@proma/shared').SystemPromptCreateInput) => Promise<import('@proma/shared').SystemPrompt>
  updateSystemPrompt: (id: string, input: import('@proma/shared').SystemPromptUpdateInput) => Promise<import('@proma/shared').SystemPrompt>
  deleteSystemPrompt: (id: string) => Promise<void>
  updateAppendSetting: (enabled: boolean) => Promise<void>
  setDefaultPrompt: (id: string | null) => Promise<void>

  getLatestRelease: () => Promise<import('@proma/shared').GitHubRelease | null>
  listReleases: (options?: import('@proma/shared').GitHubReleaseListOptions) => Promise<import('@proma/shared').GitHubRelease[]>
  getReleaseByTag: (tag: string) => Promise<import('@proma/shared').GitHubRelease | null>

  getFeishuConfig: () => Promise<import('@proma/shared').FeishuConfig>
  getDecryptedFeishuSecret: () => Promise<string>
  saveFeishuConfig: (input: import('@proma/shared').FeishuConfigInput) => Promise<import('@proma/shared').FeishuConfig>
  testFeishuConnection: (appId: string, appSecret: string) => Promise<import('@proma/shared').FeishuTestResult>
  startFeishuBridge: () => Promise<void>
  stopFeishuBridge: () => Promise<void>
  getFeishuStatus: () => Promise<import('@proma/shared').FeishuBridgeState>
  listFeishuBindings: () => Promise<import('@proma/shared').FeishuChatBinding[]>
  updateFeishuBinding: (input: import('@proma/shared').FeishuUpdateBindingInput) => Promise<import('@proma/shared').FeishuChatBinding | null>
  removeFeishuBinding: (chatId: string) => Promise<boolean>
  reportFeishuPresence: (report: import('@proma/shared').FeishuPresenceReport) => Promise<void>
  onFeishuStatusChanged: (callback: (state: import('@proma/shared').FeishuBridgeState) => void) => () => void
  getFeishuMultiConfig: () => Promise<import('@proma/shared').FeishuMultiBotConfig>
  saveFeishuBotConfig: (input: import('@proma/shared').FeishuBotConfigInput) => Promise<import('@proma/shared').FeishuBotConfig>
  getDecryptedFeishuBotSecret: (botId: string) => Promise<string>
  removeFeishuBot: (botId: string) => Promise<boolean>
  startFeishuBot: (botId: string) => Promise<void>
  stopFeishuBot: (botId: string) => Promise<void>
  getFeishuMultiStatus: () => Promise<import('@proma/shared').FeishuMultiBridgeState>
  registerFeishuApp: () => Promise<import('@proma/shared').FeishuRegisterAppResult>
  cancelFeishuRegistration: () => Promise<void>
  onFeishuRegisterQrcode: (callback: (payload: import('@proma/shared').FeishuRegisterAppQRCode) => void) => () => void
  onFeishuRegisterStatus: (callback: (payload: import('@proma/shared').FeishuRegisterAppStatus) => void) => () => void

  getDingTalkConfig: () => Promise<import('@proma/shared').DingTalkConfig>
  getDecryptedDingTalkSecret: () => Promise<string>
  saveDingTalkConfig: (input: import('@proma/shared').DingTalkConfigInput) => Promise<import('@proma/shared').DingTalkConfig>
  testDingTalkConnection: (clientId: string, clientSecret: string) => Promise<import('@proma/shared').DingTalkTestResult>
  startDingTalkBridge: () => Promise<void>
  stopDingTalkBridge: () => Promise<void>
  getDingTalkStatus: () => Promise<import('@proma/shared').DingTalkBridgeState>
  onDingTalkStatusChanged: (callback: (state: import('@proma/shared').DingTalkBridgeState) => void) => () => void
  getDingTalkMultiConfig: () => Promise<import('@proma/shared').DingTalkMultiBotConfig>
  saveDingTalkBotConfig: (input: import('@proma/shared').DingTalkBotConfigInput) => Promise<import('@proma/shared').DingTalkBotConfig>
  getDecryptedDingTalkBotSecret: (botId: string) => Promise<string>
  removeDingTalkBot: (botId: string) => Promise<boolean>
  startDingTalkBot: (botId: string) => Promise<void>
  stopDingTalkBot: (botId: string) => Promise<void>
  getDingTalkMultiStatus: () => Promise<import('@proma/shared').DingTalkMultiBridgeState>

  getWeChatConfig: () => Promise<import('@proma/shared').WeChatConfig>
  startWeChatLogin: () => Promise<void>
  logoutWeChat: () => Promise<void>
  startWeChatBridge: () => Promise<void>
  stopWeChatBridge: () => Promise<void>
  getWeChatStatus: () => Promise<import('@proma/shared').WeChatBridgeState>
  onWeChatStatusChanged: (callback: (state: import('@proma/shared').WeChatBridgeState) => void) => () => void

  onMenuCloseTab: (callback: () => void) => () => void

  submitQuickTask: (input: import('../types').QuickTaskSubmitInput) => Promise<void>
  hideQuickTask: () => Promise<void>
  reregisterGlobalShortcuts: () => Promise<Record<string, boolean>>
  onQuickTaskFocus: (callback: () => void) => () => void
  onQuickTaskOpenSession: (callback: (data: import('../types').QuickTaskOpenSessionData) => void) => () => void

  getVoiceDictationSettings: () => Promise<import('../types').VoiceDictationSettings>
  updateVoiceDictationSettings: (updates: import('../types').VoiceDictationSettingsUpdate) => Promise<import('../types').VoiceDictationSettings>
  testVoiceDictationConnection: (updates?: import('../types').VoiceDictationSettingsUpdate) => Promise<import('../types').VoiceDictationTestResult>
  toggleVoiceDictation: () => Promise<void>
  activateFromHandsfree: () => Promise<void>
  storeHandsfreeBuffer: (data: ArrayBuffer) => Promise<void>
  getHandsfreeBuffer: () => Promise<ArrayBuffer | null>
  startVoiceDictation: (input: import('../types').VoiceDictationStartInput) => Promise<void>
  sendVoiceDictationAudio: (input: import('../types').VoiceDictationAudioChunkInput) => Promise<void>
  stopVoiceDictation: (input: import('../types').VoiceDictationStopInput) => Promise<void>
  cancelVoiceDictation: (input: import('../types').VoiceDictationStopInput) => Promise<void>
  commitVoiceDictation: (input: import('../types').VoiceDictationCommitInput) => Promise<import('../types').VoiceDictationCommitResult>
  hideVoiceDictation: () => Promise<void>
  resizeVoiceDictation: (input: import('../types').VoiceDictationResizeInput) => Promise<void>
  onVoiceDictationShown: (callback: () => void) => () => void
  onVoiceDictationToggleStop: (callback: () => void) => () => void
  onVoiceDictationTranscript: (callback: (event: import('../types').VoiceDictationTranscriptEvent) => void) => () => void
  onVoiceDictationState: (callback: (event: import('../types').VoiceDictationStateEvent) => void) => () => void
  onVoiceDictationInsertText: (callback: (data: { text: string }) => void) => () => void
  onVoiceDictationBroadcastState: (callback: (data: { visible: boolean }) => void) => () => void
  checkMicrophonePermission: () => Promise<import('../types').MicPermissionResult>
  requestMicrophonePermission: () => Promise<import('../types').MicPermissionResult>

  onTrayOpenAgentSession: (callback: (data: import('../types').TrayOpenAgentSessionData) => void) => () => void
  onTrayCreateSession: (callback: (data: import('../types').TrayCreateSessionData) => void) => () => void

  migrationGetExportPreview: (workspaceId: string) => Promise<unknown>
  migrationGetShareExportPreview: () => Promise<unknown>
  migrationExport: (options: unknown) => Promise<{ success: boolean; filePath: string; warnings?: string[] }>
  migrationExportV2: (options: unknown) => Promise<{ success: boolean; filePath: string; warnings?: string[] }>
  migrationParseImportFile: (filePath: string) => Promise<unknown>
  migrationConfirmImport: (options: unknown) => Promise<{ success: boolean }>
  migrationOpenFileDialog: () => Promise<string | null>
  migrationSaveFileDialog: (mode: string) => Promise<string | null>
  onMigrationOpenImportFile: (callback: (data: { filePath: string }) => void) => () => void

  getStorageStats: () => Promise<unknown>
  cleanupStorage: (options: unknown) => Promise<unknown>
  cleanupTempStorage: () => Promise<unknown>
  migrationCancelImport: (tempDir: string) => Promise<void>

  updater?: {
    checkForUpdates: () => Promise<void>
    getStatus: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
      error?: string
    }>
    onStatusChanged: (callback: (status: Record<string, unknown>) => void) => () => void
    quitAndInstall: () => Promise<void>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
