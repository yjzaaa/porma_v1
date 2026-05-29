/**
 * Preload 用户档案、应用设置、Scratch Pad、应用图标、Dock 角标
 */

import { ipcRenderer } from 'electron'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, SCRATCH_PAD_IPC_CHANNELS, APP_ICON_IPC_CHANNELS, DOCK_BADGE_IPC_CHANNELS } from '../types'
import type { UserProfile, AppSettings } from '../types'

const api: Record<string, unknown> = {
  // ===== 用户档案 =====
  getUserProfile: () => ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.GET),
  updateUserProfile: (updates: Partial<UserProfile>) => ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.UPDATE, updates),

  // ===== 应用设置 =====
  getSettings: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET),
  updateSettings: (updates: Partial<AppSettings>) => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.UPDATE, updates),
  updateSettingsSync: (updates: Partial<AppSettings>) => ipcRenderer.sendSync(SETTINGS_IPC_CHANNELS.UPDATE_SYNC, updates),
  getSystemTheme: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME),

  onSystemThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_: unknown, isDark: boolean): void => callback(isDark)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener) }
  },

  onThemeSettingsChanged: (callback: (payload: { themeMode: string; themeStyle: string }) => void) => {
    const listener = (_: unknown, payload: { themeMode: string; themeStyle: string }): void => callback(payload)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, listener) }
  },

  // ===== Scratch Pad =====
  loadScratchPad: () => ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.LOAD),
  saveScratchPad: (content: string) => ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.SAVE, content),
  saveScratchPadSync: (content: string) => ipcRenderer.sendSync(SCRATCH_PAD_IPC_CHANNELS.SAVE_SYNC, content),
  exportScratchPad: (markdown: string, dirPath: string, filename: string) =>
    ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.EXPORT, markdown, dirPath, filename),
  chooseExportPath: (defaultName: string) => ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.CHOOSE_EXPORT_PATH, defaultName),

  // ===== 应用图标 =====
  setAppIcon: (variantId: string) => ipcRenderer.invoke(APP_ICON_IPC_CHANNELS.SET, variantId),
  setDockBadgeCount: (count: number) => ipcRenderer.invoke(DOCK_BADGE_IPC_CHANNELS.SET_COUNT, count),
}

export default api
