/**
 * IPC 钉钉 & 微信集成处理器
 */

import { ipcMain } from 'electron'
import { DINGTALK_IPC_CHANNELS, WECHAT_IPC_CHANNELS } from '@proma/shared'
import type {
  DingTalkConfig,
  DingTalkConfigInput,
  DingTalkBridgeState,
  DingTalkTestResult,
  WeChatConfig,
  WeChatBridgeState,
} from '@proma/shared'
import {
  getDingTalkConfig,
  saveDingTalkConfig,
  getDecryptedClientSecret,
  getDingTalkMultiBotConfig,
  saveDingTalkBotConfig,
  removeDingTalkBot,
  getDecryptedBotClientSecret,
} from '../lib/dingtalk-config'
import { dingtalkBridgeManager } from '../lib/dingtalk-bridge-manager'
import { getWeChatConfig } from '../lib/wechat-config'
import { wechatBridge } from '../lib/wechat-bridge'

export function registerIntegrationHandlers(): void {
  // ===== 钉钉集成（旧 API，向后兼容）=====

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<DingTalkConfig> => {
      return getDingTalkConfig()
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_DECRYPTED_SECRET,
    async (): Promise<string> => {
      return getDecryptedClientSecret()
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.SAVE_CONFIG,
    async (_, input: DingTalkConfigInput): Promise<DingTalkConfig> => {
      return saveDingTalkConfig(input)
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.TEST_CONNECTION,
    async (_, clientId: string, clientSecret: string): Promise<DingTalkTestResult> => {
      return dingtalkBridgeManager.testConnection(clientId, clientSecret)
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await dingtalkBridgeManager.startAll()
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      dingtalkBridgeManager.stopAll()
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_STATUS,
    async (): Promise<DingTalkBridgeState> => {
      const states = dingtalkBridgeManager.getStates()
      const first = Object.values(states.bots)[0]
      return first ?? { status: 'disconnected' }
    }
  )

  // ===== 钉钉多 Bot v2 API =====

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_MULTI_CONFIG,
    async () => {
      return getDingTalkMultiBotConfig()
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.SAVE_BOT_CONFIG,
    async (_, input: import('@proma/shared').DingTalkBotConfigInput) => {
      const saved = saveDingTalkBotConfig(input)
      if (saved.enabled && saved.clientId && saved.clientSecret) {
        dingtalkBridgeManager.restartBot(saved.id).catch((err) => {
          console.error(`[钉钉 IPC] Bot "${saved.name}" 重启失败:`, err)
        })
      } else {
        dingtalkBridgeManager.stopBot(saved.id)
      }
      return saved
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.REMOVE_BOT,
    async (_, botId: string) => {
      dingtalkBridgeManager.stopBot(botId)
      return removeDingTalkBot(botId)
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET,
    async (_, botId: string) => {
      return getDecryptedBotClientSecret(botId)
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.START_BOT,
    async (_, botId: string) => {
      await dingtalkBridgeManager.startBot(botId)
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.STOP_BOT,
    async (_, botId: string) => {
      dingtalkBridgeManager.stopBot(botId)
    }
  )

  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_MULTI_STATUS,
    async () => {
      return dingtalkBridgeManager.getStates()
    }
  )

  // ===== 微信集成 =====

  ipcMain.handle(
    WECHAT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<WeChatConfig> => {
      return getWeChatConfig()
    }
  )

  ipcMain.handle(
    WECHAT_IPC_CHANNELS.START_LOGIN,
    async (): Promise<void> => {
      await wechatBridge.startLogin()
    }
  )

  ipcMain.handle(
    WECHAT_IPC_CHANNELS.LOGOUT,
    async (): Promise<void> => {
      wechatBridge.logout()
    }
  )

  ipcMain.handle(
    WECHAT_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await wechatBridge.start()
    }
  )

  ipcMain.handle(
    WECHAT_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      wechatBridge.stop()
    }
  )

  ipcMain.handle(
    WECHAT_IPC_CHANNELS.GET_STATUS,
    async (): Promise<WeChatBridgeState> => {
      return wechatBridge.getStatus()
    }
  )
}
