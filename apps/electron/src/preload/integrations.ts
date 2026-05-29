/**
 * Preload 钉钉、微信集成 + 菜单事件
 */

import { ipcRenderer } from 'electron'
import { DINGTALK_IPC_CHANNELS, WECHAT_IPC_CHANNELS } from '@proma/shared'
import type {
  DingTalkConfig,
  DingTalkConfigInput,
  DingTalkBridgeState,
  DingTalkTestResult,
  WeChatConfig,
  WeChatBridgeState,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== 钉钉 =====
  getDingTalkConfig: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_CONFIG),
  getDecryptedDingTalkSecret: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_DECRYPTED_SECRET),
  saveDingTalkConfig: (input: DingTalkConfigInput) => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.SAVE_CONFIG, input),
  testDingTalkConnection: (clientId: string, clientSecret: string) =>
    ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.TEST_CONNECTION, clientId, clientSecret),
  startDingTalkBridge: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.START_BRIDGE),
  stopDingTalkBridge: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.STOP_BRIDGE),
  getDingTalkStatus: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_STATUS),

  onDingTalkStatusChanged: (callback: (state: DingTalkBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DingTalkBridgeState): void => callback(state)
    ipcRenderer.on(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  getDingTalkMultiConfig: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_MULTI_CONFIG),
  saveDingTalkBotConfig: (input: import('@proma/shared').DingTalkBotConfigInput) =>
    ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.SAVE_BOT_CONFIG, input),
  getDecryptedDingTalkBotSecret: (botId: string) =>
    ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET, botId),
  removeDingTalkBot: (botId: string) => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.REMOVE_BOT, botId),
  startDingTalkBot: (botId: string) => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.START_BOT, botId),
  stopDingTalkBot: (botId: string) => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.STOP_BOT, botId),
  getDingTalkMultiStatus: () => ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_MULTI_STATUS),

  // ===== 微信 =====
  getWeChatConfig: () => ipcRenderer.invoke(WECHAT_IPC_CHANNELS.GET_CONFIG),
  startWeChatLogin: () => ipcRenderer.invoke(WECHAT_IPC_CHANNELS.START_LOGIN),
  logoutWeChat: () => ipcRenderer.invoke(WECHAT_IPC_CHANNELS.LOGOUT),
  startWeChatBridge: () => ipcRenderer.invoke(WECHAT_IPC_CHANNELS.START_BRIDGE),
  stopWeChatBridge: () => ipcRenderer.invoke(WECHAT_IPC_CHANNELS.STOP_BRIDGE),
  getWeChatStatus: () => ipcRenderer.invoke(WECHAT_IPC_CHANNELS.GET_STATUS),

  onWeChatStatusChanged: (callback: (state: WeChatBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WeChatBridgeState): void => callback(state)
    ipcRenderer.on(WECHAT_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(WECHAT_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  // ===== 菜单事件 =====
  onMenuCloseTab: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('menu:close-tab', listener)
    return () => { ipcRenderer.removeListener('menu:close-tab', listener) }
  },
}

export default api
