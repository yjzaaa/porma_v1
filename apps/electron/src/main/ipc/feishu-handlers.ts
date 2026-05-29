/**
 * IPC 飞书集成处理器
 *
 * 飞书配置管理、Bridge 启停、多 Bot 管理、扫码注册。
 */

import { ipcMain } from 'electron'
import { FEISHU_IPC_CHANNELS } from '@proma/shared'
import type {
  FeishuConfig,
  FeishuConfigInput,
  FeishuBridgeState,
  FeishuTestResult,
  FeishuChatBinding,
  FeishuPresenceReport,
  FeishuUpdateBindingInput,
  FeishuRegisterAppQRCode,
  FeishuRegisterAppStatus,
  FeishuRegisterAppResult,
} from '@proma/shared'
import {
  getFeishuConfig,
  saveFeishuConfig,
  getDecryptedAppSecret,
  getFeishuMultiBotConfig,
  saveFeishuBotConfig,
  removeFeishuBot,
  getDecryptedBotAppSecret,
} from '../lib/feishu-config'
import { feishuBridgeManager } from '../lib/feishu-bridge-manager'
import { presenceService } from '../lib/feishu-presence'

export function registerFeishuHandlers(): void {
  // ===== 飞书集成（旧 API，向后兼容）=====

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<FeishuConfig> => {
      return getFeishuConfig()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_DECRYPTED_SECRET,
    async (): Promise<string> => {
      return getDecryptedAppSecret()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.SAVE_CONFIG,
    async (_, input: FeishuConfigInput): Promise<FeishuConfig> => {
      const config = saveFeishuConfig(input)
      const multi = getFeishuMultiBotConfig()
      const firstBot = multi.bots[0]
      if (firstBot) {
        if (input.enabled && input.appId && input.appSecret) {
          await feishuBridgeManager.restartBot(firstBot.id)
        } else if (!input.enabled) {
          feishuBridgeManager.stopBot(firstBot.id)
        }
      }
      return config
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await feishuBridgeManager.startAll()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      feishuBridgeManager.stopAll()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_STATUS,
    async (): Promise<FeishuBridgeState> => {
      const states = feishuBridgeManager.getStates()
      const first = Object.values(states.bots)[0]
      return first ?? { status: 'disconnected', activeBindings: 0 }
    }
  )

  // ===== 飞书多 Bot v2 API =====

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_MULTI_CONFIG,
    async () => {
      return getFeishuMultiBotConfig()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.SAVE_BOT_CONFIG,
    async (_, input: import('@proma/shared').FeishuBotConfigInput) => {
      const saved = saveFeishuBotConfig(input)
      if (saved.enabled && saved.appId && saved.appSecret) {
        feishuBridgeManager.restartBot(saved.id).catch((err) => {
          console.error(`[飞书 IPC] Bot "${saved.name}" 重启失败:`, err)
        })
      } else {
        feishuBridgeManager.stopBot(saved.id)
      }
      return saved
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REMOVE_BOT,
    async (_, botId: string) => {
      feishuBridgeManager.stopBot(botId)
      return removeFeishuBot(botId)
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET,
    async (_, botId: string) => {
      return getDecryptedBotAppSecret(botId)
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.START_BOT,
    async (_, botId: string) => {
      await feishuBridgeManager.startBot(botId)
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.STOP_BOT,
    async (_, botId: string) => {
      feishuBridgeManager.stopBot(botId)
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_MULTI_STATUS,
    async () => {
      return feishuBridgeManager.getStates()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.TEST_CONNECTION,
    async (_, appId: string, appSecret: string): Promise<FeishuTestResult> => {
      return feishuBridgeManager.testConnection(appId, appSecret)
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.LIST_BINDINGS,
    async (): Promise<FeishuChatBinding[]> => {
      return feishuBridgeManager.listAllBindings()
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.UPDATE_BINDING,
    async (_, input: FeishuUpdateBindingInput): Promise<FeishuChatBinding | null> => {
      const bridge = feishuBridgeManager.findBridgeByChatId(input.chatId)
      return bridge?.updateBinding(input) ?? null
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REMOVE_BINDING,
    async (_, chatId: string): Promise<boolean> => {
      const bridge = feishuBridgeManager.findBridgeByChatId(chatId)
      return bridge?.removeBinding(chatId) ?? false
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REPORT_PRESENCE,
    async (_, report: FeishuPresenceReport): Promise<void> => {
      presenceService.updatePresence(report)
    }
  )

  // ===== 飞书扫码注册 =====

  let activeRegisterAbort: AbortController | null = null

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REGISTER_APP_START,
    async (event): Promise<FeishuRegisterAppResult> => {
      if (activeRegisterAbort) {
        activeRegisterAbort.abort()
      }
      const abort = new AbortController()
      activeRegisterAbort = abort

      try {
        const lark = await import('@larksuiteoapi/node-sdk')
        const QRCode = (await import('qrcode')).default
        const result = await lark.registerApp({
          source: 'proma',
          signal: abort.signal,
          onQRCodeReady: async (info) => {
            if (event.sender.isDestroyed()) return
            try {
              const dataUrl = await QRCode.toDataURL(info.url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
              if (event.sender.isDestroyed()) return
              const payload: FeishuRegisterAppQRCode = {
                url: info.url,
                dataUrl,
                expireIn: info.expireIn,
              }
              event.sender.send(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, payload)
            } catch (err) {
              console.error('[飞书扫码注册] QRCode 生成失败:', err)
              if (event.sender.isDestroyed()) return
              event.sender.send(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, {
                url: info.url,
                dataUrl: '',
                expireIn: info.expireIn,
              })
            }
          },
          onStatusChange: (info) => {
            if (event.sender.isDestroyed()) return
            const payload: FeishuRegisterAppStatus = {
              status: info.status,
              interval: info.interval,
            }
            event.sender.send(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, payload)
          },
        })
        return {
          appId: result.client_id,
          appSecret: result.client_secret,
          tenantBrand: result.user_info?.tenant_brand,
          operatorOpenId: result.user_info?.open_id,
        }
      } finally {
        if (activeRegisterAbort === abort) {
          activeRegisterAbort = null
        }
      }
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REGISTER_APP_CANCEL,
    async (): Promise<void> => {
      activeRegisterAbort?.abort()
      activeRegisterAbort = null
    }
  )
}
