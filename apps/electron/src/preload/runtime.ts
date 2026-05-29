/**
 * Preload 运行时、窗口控制、环境检测、安装包、代理、截图
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, INSTALLER_IPC_CHANNELS, PROXY_IPC_CHANNELS } from '@proma/shared'
import type {
  DetachedPreviewWindowData,
  DetachedPreviewWindowInput,
  InstallerManifest,
  InstallerDownloadRequest,
  InstallerDownloadResult,
  InstallerProgressPayload,
  ProxyConfig,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== 运行时 =====
  getRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_RUNTIME_STATUS),
  reinitRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.REINIT_RUNTIME),
  getGitRepoStatus: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_GIT_REPO_STATUS, dirPath),

  getUnstagedChanges: (dirPath: string, sessionPath?: string, workspaceFilesPath?: string, extraPaths?: string[], sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_UNSTAGED_CHANGES, dirPath, sessionPath, workspaceFilesPath, extraPaths, sessionId),

  getFileDiff: (input: import('@proma/shared').GetFileDiffInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_FILE_DIFF, input),

  getUntrackedContent: (input: import('@proma/shared').GetFileDiffInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_UNTRACKED_CONTENT, input),

  revertFile: (input: import('@proma/shared').RevertFileInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.REVERT_FILE, input),

  getDiffContents: (input: import('@proma/shared').GetFileDiffInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_DIFF_CONTENTS, input),

  openDetachedPreview: (input: DetachedPreviewWindowInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_DETACHED_PREVIEW, input) as Promise<string | null>,

  getDetachedPreviewData: (previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_DETACHED_PREVIEW_DATA, previewId) as Promise<DetachedPreviewWindowData | null>,

  // ===== 通用工具 =====
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),

  // ===== 窗口控制 =====
  windowMinimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  windowIsMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),

  onWindowResize: (callback: () => void) => {
    const handler = (): void => callback()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  },

  // ===== 系统打开文件 / 编辑器扫描 =====
  systemOpenFile: (filePath: string, appName?: string, access?: import('@proma/shared').FileAccessOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_FILE, filePath, appName, access),

  scanEditors: () => ipcRenderer.invoke(IPC_CHANNELS.SCAN_EDITORS),

  getDefaultAppForFile: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_DEFAULT_APP_FOR_FILE, filePath) as Promise<import('@proma/shared').DefaultAppInfo | null>,

  // ===== 截图 =====
  screenshotCapture: (input: { html: string; isDark: boolean; width?: number; mode: 'clipboard' | 'file'; css?: string; themeClass?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE, input) as Promise<{ success: boolean; message: string; filePath?: string }>,

  // ===== 拖拽文件路径 =====
  getPathForFile: (file: File) => {
    const { webUtils } = require('electron')
    return webUtils.getPathForFile(file)
  },

  // ===== 环境检测 =====
  checkEnvironment: () => ipcRenderer.invoke(ENVIRONMENT_IPC_CHANNELS.CHECK),

  // ===== 第三方安装包 =====
  fetchInstallerManifest: () => ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.MANIFEST),
  downloadInstaller: (req: InstallerDownloadRequest) => ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.DOWNLOAD, req),
  cancelInstallerDownload: (key: string) => ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.CANCEL, key),
  launchInstaller: (filePath: string) => ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.LAUNCH, filePath),

  onInstallerProgress: (callback: (payload: InstallerProgressPayload) => void) => {
    const listener = (_: unknown, payload: InstallerProgressPayload) => callback(payload)
    ipcRenderer.on(INSTALLER_IPC_CHANNELS.PROGRESS, listener)
    return () => ipcRenderer.off(INSTALLER_IPC_CHANNELS.PROGRESS, listener)
  },

  // ===== 代理配置 =====
  getProxySettings: () => ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_SETTINGS),
  updateProxySettings: (config: ProxyConfig) => ipcRenderer.invoke(PROXY_IPC_CHANNELS.UPDATE_SETTINGS, config),
  detectSystemProxy: () => ipcRenderer.invoke(PROXY_IPC_CHANNELS.DETECT_SYSTEM),
}

export default api
