/**
 * Preload 系统提示词管理 + GitHub Release
 */

import { ipcRenderer } from 'electron'
import { SYSTEM_PROMPT_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS } from '@proma/shared'
import type {
  SystemPromptConfig,
  SystemPrompt,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
  GitHubRelease,
  GitHubReleaseListOptions,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== 系统提示词 =====
  getSystemPromptConfig: () => ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG),
  createSystemPrompt: (input: SystemPromptCreateInput) =>
    ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.CREATE, input),
  updateSystemPrompt: (id: string, input: SystemPromptUpdateInput) =>
    ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE, id, input),
  deleteSystemPrompt: (id: string) => ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.DELETE, id),
  updateAppendSetting: (enabled: boolean) =>
    ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING, enabled),
  setDefaultPrompt: (id: string | null) => ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT, id),

  // ===== GitHub Release =====
  getLatestRelease: () => ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE),
  listReleases: (options?: GitHubReleaseListOptions) =>
    ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES, options),
  getReleaseByTag: (tag: string) => ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG, tag),
}

export default api
