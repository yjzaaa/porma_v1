/**
 * Preload Agent 附件管理、文件系统操作（AGENT_IPC_CHANNELS 第三部分 + file: 通道）
 */

import { ipcRenderer } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type {
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  AgentAttachFileInput,
  WorkspaceAttachDirectoryInput,
  WorkspaceAttachFileInput,
  FileEntry,
  FileSearchResult,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== Agent 附件 =====
  saveFilesToAgentSession: (input: AgentSaveFilesInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION, input),

  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE, input),

  getWorkspaceFilesPath: (workspaceSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH, workspaceSlug),

  openFolderDialog: () => ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG),

  attachDirectory: (input: AgentAttachDirectoryInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_DIRECTORY, input),

  detachDirectory: (input: AgentAttachDirectoryInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_DIRECTORY, input),

  attachFile: (input: AgentAttachFileInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_FILE, input),

  detachFile: (input: AgentAttachFileInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_FILE, input),

  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY, input),

  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY, input),

  attachWorkspaceFile: (input: WorkspaceAttachFileInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_FILE, input),

  detachWorkspaceFile: (input: WorkspaceAttachFileInput) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_FILE, input),

  getWorkspaceDirectories: (workspaceSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES, workspaceSlug),

  getWorkspaceAttachedFiles: (workspaceSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_ATTACHED_FILES, workspaceSlug),

  // ===== Agent 文件系统操作 =====
  getAgentSessionPath: (workspaceId: string, sessionId: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SESSION_PATH, workspaceId, sessionId),

  listDirectory: (dirPath: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_DIRECTORY, dirPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_FILE, filePath),
  openFile: (filePath: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FILE, filePath),

  writeClipboardPreview: (filename: string, content: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_CLIPBOARD_PREVIEW, filename, content),

  showInFolder: (filePath: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_IN_FOLDER, filePath),

  resolveAndReadFile: (filePath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke('file:resolve-and-read', filePath, access) as Promise<{ resolvedPath: string; content: string } | null>,

  writeTextFile: (filePath: string, content: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke('file:write-text', filePath, content, access) as Promise<boolean>,

  resolveFilePath: (filePath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke('file:resolve-path', filePath, access) as Promise<import('@proma/shared').ResolvedFileUrl | null>,

  preparePdfPreview: (filePath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke('file:prepare-pdf-preview', filePath, access) as Promise<{ tmpHtmlUrl: string } | null>,

  readBinaryBase64: (filePath: string, access?: import('@proma/shared').FileAccessOptions, maxSize?: number) =>
    ipcRenderer.invoke('file:read-binary-base64', filePath, access, maxSize) as Promise<string | null>,

  docxToHtml: (filePath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke('file:docx-to-html', filePath, access) as Promise<{ resolvedPath: string; html: string } | null>,

  officeToHtml: (filePath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke('file:office-to-html', filePath, access) as Promise<import('@proma/shared').OfficePreviewResult | null>,

  renameFile: (filePath: string, newName: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_FILE, filePath, newName),

  moveFile: (filePath: string, targetDir: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_FILE, filePath, targetDir),

  listAttachedDirectory: (dirPath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY, dirPath, access),

  readAttachedFile: (filePath: string, sessionId?: string, workspaceSlug?: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_ATTACHED_FILE, filePath, sessionId, workspaceSlug),

  showAttachedInFolder: (filePath: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER, filePath, access),

  renameAttachedFile: (filePath: string, newName: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE, filePath, newName, access),

  moveAttachedFile: (filePath: string, targetDir: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE, filePath, targetDir, access),

  checkPathsType: (paths: string[]) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE, paths),

  searchWorkspaceFiles: (rootPath: string, query: string, limit = 20, additionalPaths?: string[], sessionPaths?: string[]) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES, rootPath, query, limit, additionalPaths, sessionPaths),
}

export default api
