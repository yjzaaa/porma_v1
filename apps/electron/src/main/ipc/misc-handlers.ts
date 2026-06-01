/**
 * IPC 杂项处理器
 *
 * 系统提示词、GitHub Release、存储管理、快速任务、语音输入、数据迁移、窗口控制。
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { IPC_CHANNELS, SYSTEM_PROMPT_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS } from '@proma/shared'
import { QUICK_TASK_IPC_CHANNELS, VOICE_DICTATION_IPC_CHANNELS, STORAGE_IPC_CHANNELS } from '../../types'
import type {
  QuickTaskSubmitInput,
  VoiceDictationAudioChunkInput,
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationResizeInput,
  VoiceDictationSettings,
  VoiceDictationSettingsUpdate,
  VoiceDictationStartInput,
  VoiceDictationStopInput,
  VoiceDictationTestResult,
  MicPermissionResult,
} from '../../types'
import type {
  SystemPromptConfig,
  SystemPrompt,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
  GitHubRelease,
  GitHubReleaseListOptions,
} from '@proma/shared'
import type { CleanupOptions } from '../lib/storage/storage-service'
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  updateAppendSetting,
  setDefaultPrompt,
} from '../lib/agent/system-prompt-manager'
import {
  getLatestRelease,
  listReleases as listGitHubReleases,
  getReleaseByTag,
} from '../lib/integration/github-release-service'
import { calculateStorageStats, cleanupStorage, cleanupTempFiles } from '../lib/storage/storage-service'

export function registerMiscHandlers(): void {
  // ===== 系统提示词管理 =====

  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<SystemPromptConfig> => {
      return getSystemPromptConfig()
    }
  )

  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.CREATE,
    async (_, input: SystemPromptCreateInput): Promise<SystemPrompt> => {
      return createSystemPrompt(input)
    }
  )

  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: SystemPromptUpdateInput): Promise<SystemPrompt> => {
      return updateSystemPrompt(id, input)
    }
  )

  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      return deleteSystemPrompt(id)
    }
  )

  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING,
    async (_, enabled: boolean): Promise<void> => {
      return updateAppendSetting(enabled)
    }
  )

  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT,
    async (_, id: string | null): Promise<void> => {
      return setDefaultPrompt(id)
    }
  )

  // ===== GitHub Release =====

  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE,
    async (): Promise<GitHubRelease | null> => {
      return getLatestRelease()
    }
  )

  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES,
    async (_, options?: GitHubReleaseListOptions): Promise<GitHubRelease[]> => {
      return listGitHubReleases(options)
    }
  )

  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG,
    async (_, tag: string): Promise<GitHubRelease | null> => {
      return getReleaseByTag(tag)
    }
  )

  // ===== 存储管理 =====

  ipcMain.handle(STORAGE_IPC_CHANNELS.GET_STATS, async () => {
    return calculateStorageStats()
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP, async (_, options: CleanupOptions) => {
    return cleanupStorage(options)
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP_TEMP, async () => {
    return cleanupTempFiles()
  })

  ipcMain.handle('migration:cancelImport', async (_, tempDir: string) => {
    if (tempDir && existsSync(tempDir) && tempDir.includes('proma-import-')) {
      rmSync(tempDir, { recursive: true, force: true })
      console.log(`[迁移] 已清理临时目录: ${tempDir}`)
    }
  })

  // ===== 快速任务窗口 =====

  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.SUBMIT,
    async (_, input: QuickTaskSubmitInput): Promise<void> => {
      const { hideQuickTaskWindow } = await import('../lib/window/quick-task-window')
      const { getMainWindow } = await import('../index')
      hideQuickTaskWindow()

      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('quick-task:open-session', {
          mode: input.mode,
          text: input.text,
          files: input.files,
        })
        mainWin.show()
        mainWin.focus()
      }
    }
  )

  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideQuickTaskWindow } = await import('../lib/window/quick-task-window')
      hideQuickTaskWindow()
    }
  )

  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS,
    async (): Promise<Record<string, boolean>> => {
      const { reregisterAllGlobalShortcuts } = await import('../lib/system/global-shortcut-service')
      return reregisterAllGlobalShortcuts()
    }
  )

  // ===== 语音输入 =====

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<VoiceDictationSettings> => {
      const { getVoiceDictationSettings } = await import('../lib/integration/voice-dictation-settings-service')
      return getVoiceDictationSettings()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, updates: VoiceDictationSettingsUpdate): Promise<VoiceDictationSettings> => {
      const { updateVoiceDictationSettings } = await import('../lib/integration/voice-dictation-settings-service')
      return updateVoiceDictationSettings(updates)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION,
    async (_, updates?: VoiceDictationSettingsUpdate): Promise<VoiceDictationTestResult> => {
      const { getVoiceDictationSettings } = await import('../lib/integration/voice-dictation-settings-service')
      const { testDoubaoAsrConnection } = await import('../lib/integration/doubao-asr-service')
      const settings = { ...getVoiceDictationSettings(), ...(updates ?? {}) }
      return testDoubaoAsrConnection(settings)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TOGGLE,
    async (event): Promise<void> => {
      const { toggleVoiceDictationWindow } = await import('../lib/window/voice-dictation-window')
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)
      toggleVoiceDictationWindow({ targetIsProma: !!sourceWindow })
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.ACTIVATE_FROM_HANDSFREE,
    async (event): Promise<void> => {
      // 原子操作：先启用语音输入，再打开浮窗
      // 在同一个事件循环内完成，避免渲染进程两次 IPC 的竞态
      const { getVoiceDictationSettings, updateVoiceDictationSettings } = await import('../lib/integration/voice-dictation-settings-service')
      const current = getVoiceDictationSettings()
      if (!current.enabled) {
        updateVoiceDictationSettings({ enabled: true })
      }

      // 如果浮窗已显示且正在录音中，不做任何事（防止检测器反复 toggle 中断录音）
      const { getVoiceDictationWindow, toggleVoiceDictationWindow } = await import('../lib/window/voice-dictation-window')
      const existingWin = getVoiceDictationWindow()
      if (existingWin && !existingWin.isDestroyed() && existingWin.isVisible()) {
        return
      }

      const sourceWindow = BrowserWindow.fromWebContents(event.sender)
      toggleVoiceDictationWindow({ targetIsProma: !!sourceWindow })
    }
  )

  // ===== 免提模式录音缓冲区（环形缓冲区 IPC 桥接） =====

  let handsfreeAudioBuffer: ArrayBuffer | null = null

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.STORE_HANDSFREE_BUFFER,
    (_, data: ArrayBuffer): void => {
      handsfreeAudioBuffer = data
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.GET_HANDSFREE_BUFFER,
    (): ArrayBuffer | null => {
      const buf = handsfreeAudioBuffer
      handsfreeAudioBuffer = null
      return buf
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.START,
    async (event, input: VoiceDictationStartInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('../lib/integration/voice-dictation-settings-service')
      const { startDoubaoAsrSession } = await import('../lib/integration/doubao-asr-service')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('语音输入窗口不存在')
      await startDoubaoAsrSession(input.sessionId, getVoiceDictationSettings(), win)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO,
    async (_, input: VoiceDictationAudioChunkInput): Promise<void> => {
      const { sendDoubaoAsrAudio } = await import('../lib/integration/doubao-asr-service')
      sendDoubaoAsrAudio(input.sessionId, input.data)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.STOP,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { stopDoubaoAsrSession } = await import('../lib/integration/doubao-asr-service')
      await stopDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CANCEL,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { cancelDoubaoAsrSession } = await import('../lib/integration/doubao-asr-service')
      cancelDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.COMMIT,
    async (_, input: VoiceDictationCommitInput): Promise<VoiceDictationCommitResult> => {
      const { getVoiceDictationSettings } = await import('../lib/integration/voice-dictation-settings-service')
      const { commitVoiceDictationText } = await import('../lib/text/text-output-service')
      return commitVoiceDictationText(input.text, getVoiceDictationSettings())
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideVoiceDictationWindow } = await import('../lib/window/voice-dictation-window')
      hideVoiceDictationWindow()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.RESIZE,
    async (_, input: VoiceDictationResizeInput): Promise<void> => {
      const { resizeVoiceDictationWindow } = await import('../lib/window/voice-dictation-window')
      resizeVoiceDictationWindow(input)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { checkMicrophonePermission } = await import('../lib/system/microphone-permission-service')
      return checkMicrophonePermission()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { requestMicrophonePermission } = await import('../lib/system/microphone-permission-service')
      return requestMicrophonePermission()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.WRITE_LOG,
    async (_, logContent: string): Promise<void> => {
      const { appendFileSync, existsSync, mkdirSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { app } = await import('electron')

      try {
        const logDir = join(app.getPath('userData'), 'logs')
        if (!existsSync(logDir)) {
          mkdirSync(logDir, { recursive: true })
        }

        const logFile = join(logDir, 'voice-dictation.log')
        const timestamp = new Date().toISOString()
        appendFileSync(logFile, `[${timestamp}] ${logContent}\n`, 'utf-8')
      } catch (error) {
        console.error('[语音听写] 写入日志文件失败:', error)
      }
    }
  )

  // ===== 数据迁移 =====

  ipcMain.handle('migration:getExportPreview', async (_, workspaceId: string) => {
    const { getExportPreview } = await import('../lib/storage/migration-service')
    return getExportPreview(workspaceId)
  })

  ipcMain.handle('migration:getShareExportPreview', async () => {
    const { getShareExportPreview } = await import('../lib/storage/migration-service')
    return getShareExportPreview()
  })

  ipcMain.handle('migration:export', async (_, options) => {
    const { exportData } = await import('../lib/storage/migration-service')
    return exportData(options)
  })

  ipcMain.handle('migration:exportV2', async (_, options) => {
    const { exportDataV2 } = await import('../lib/storage/migration-service')
    return exportDataV2(options)
  })

  ipcMain.handle('migration:parseImportFile', async (_, filePath: string) => {
    const { parseImportFile } = await import('../lib/storage/migration-service')
    return parseImportFile(filePath)
  })

  ipcMain.handle('migration:confirmImport', async (_, options) => {
    const { confirmImport } = await import('../lib/storage/migration-service')
    return confirmImport(options)
  })

  ipcMain.handle('migration:openFileDialog', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      title: '选择迁移文件',
      filters: [
        { name: 'Proma 迁移文件', extensions: ['proma-backup', 'proma-share'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('migration:saveFileDialog', async (_, mode: string) => {
    const { dialog } = await import('electron')
    const ext = mode === 'personal' ? 'proma-backup' : 'proma-share'
    const defaultName = `proma-migration-${new Date().toISOString().slice(0, 10)}.${ext}`
    const result = await dialog.showSaveDialog({
      title: '保存迁移文件',
      defaultPath: defaultName,
      filters: [
        { name: mode === 'personal' ? 'Proma 个人备份' : 'Proma 分享包', extensions: [ext] },
      ],
    })
    return result.canceled ? null : result.filePath
  })

  // ===== 窗口控制（Windows 自定义标题栏按钮）=====

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MINIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.minimize()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MAXIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.isMaximized() ? win.unmaximize() : win.maximize()
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_CLOSE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.close()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_MAXIMIZED,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isMaximized() : false
    }
  )
}
