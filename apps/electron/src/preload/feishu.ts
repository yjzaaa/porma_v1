/**
 * Preload 飞书集成（FEISHU_IPC_CHANNELS）
 */

import { ipcRenderer } from 'electron'
import { FEISHU_IPC_CHANNELS } from '@proma/shared'
import type {
  FeishuConfig,
  FeishuConfigInput,
  FeishuBridgeState,
  FeishuTestResult,
  FeishuChatBinding,
  FeishuPresenceReport,
  FeishuUpdateBindingInput,
} from '@proma/shared'

const api: Record<string, unknown> = {
  getFeishuConfig: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_CONFIG),
  getDecryptedFeishuSecret: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_DECRYPTED_SECRET),
  saveFeishuConfig: (input: FeishuConfigInput) => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_CONFIG, input),
  testFeishuConnection: (appId: string, appSecret: string) =>
    ipcRenderer.invoke(FEISHU_IPC_CHANNELS.TEST_CONNECTION, appId, appSecret),

  startFeishuBridge: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BRIDGE),
  stopFeishuBridge: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BRIDGE),
  getFeishuStatus: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_STATUS),

  listFeishuBindings: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.LIST_BINDINGS),
  updateFeishuBinding: (input: FeishuUpdateBindingInput) =>
    ipcRenderer.invoke(FEISHU_IPC_CHANNELS.UPDATE_BINDING, input),
  removeFeishuBinding: (chatId: string) => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BINDING, chatId),
  reportFeishuPresence: (report: FeishuPresenceReport) =>
    ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REPORT_PRESENCE, report),

  onFeishuStatusChanged: (callback: (state: FeishuBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: FeishuBridgeState): void => callback(state)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  getFeishuMultiConfig: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_MULTI_CONFIG),
  saveFeishuBotConfig: (input: import('@proma/shared').FeishuBotConfigInput) =>
    ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_BOT_CONFIG, input),
  getDecryptedFeishuBotSecret: (botId: string) =>
    ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET, botId),
  removeFeishuBot: (botId: string) => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BOT, botId),
  startFeishuBot: (botId: string) => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BOT, botId),
  stopFeishuBot: (botId: string) => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BOT, botId),
  getFeishuMultiStatus: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_MULTI_STATUS),

  registerFeishuApp: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REGISTER_APP_START),
  cancelFeishuRegistration: () => ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REGISTER_APP_CANCEL),

  onFeishuRegisterQrcode: (callback: (payload: import('@proma/shared').FeishuRegisterAppQRCode) => void) => {
    const listener = (_: unknown, payload: import('@proma/shared').FeishuRegisterAppQRCode) => callback(payload)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, listener) }
  },

  onFeishuRegisterStatus: (callback: (payload: import('@proma/shared').FeishuRegisterAppStatus) => void) => {
    const listener = (_: unknown, payload: import('@proma/shared').FeishuRegisterAppStatus) => callback(payload)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, listener) }
  },
}

export default api
