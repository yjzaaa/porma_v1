/**
 * Preload 渠道管理（CHANNEL_IPC_CHANNELS）
 */

import { ipcRenderer } from 'electron'
import { CHANNEL_IPC_CHANNELS } from '@proma/shared'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
} from '@proma/shared'

const api: Record<string, unknown> = {
  listChannels: () => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.LIST),
  createChannel: (input: ChannelCreateInput) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CREATE, input),
  updateChannel: (id: string, input: ChannelUpdateInput) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.UPDATE, id, input),
  deleteChannel: (id: string) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DELETE, id),

  decryptApiKey: (channelId: string) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DECRYPT_KEY, channelId),

  testChannel: (channelId: string) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST, channelId),
  testChannelDirect: (input: FetchModelsInput) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST_DIRECT, input),
  fetchModels: (input: FetchModelsInput) => ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.FETCH_MODELS, input),
}

export default api
