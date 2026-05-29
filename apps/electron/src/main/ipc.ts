/**
 * IPC 处理器模块
 *
 * 负责注册主进程和渲染进程之间的通信处理器。
 * 各通道组处理器拆分到 ipc/ 子目录。
 */

import { registerUpdaterIpc } from './lib/updater/updater-ipc'
import { autoArchiveConversations } from './lib/conversation/conversation-manager'
import { autoArchiveAgentSessions } from './lib/agent/agent-session-manager'
import { getSettings } from './lib/storage/settings-service'
import { cleanupTempFiles, cleanupStorage } from './lib/storage/storage-service'

import { registerRuntimeHandlers } from './ipc/runtime-handlers'
import { registerChannelHandlers } from './ipc/channel-handlers'
import { registerChatHandlers } from './ipc/chat-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerSystemHandlers } from './ipc/system-handlers'
import { registerAgentSessionHandlers } from './ipc/agent-session-handlers'
import { registerAgentWorkspaceHandlers } from './ipc/agent-workspace-handlers'
import { registerAgentPermissionHandlers } from './ipc/agent-permission-handlers'
import { registerAgentFileHandlers } from './ipc/agent-file-handlers'
import { registerFeishuHandlers } from './ipc/feishu-handlers'
import { registerIntegrationHandlers } from './ipc/integration-handlers'
import { registerMiscHandlers } from './ipc/misc-handlers'

export { resolveAppIconPath } from './ipc/helpers'

export function registerIpcHandlers(): void {
  console.log('[IPC] 正在注册 IPC 处理器...')

  registerRuntimeHandlers()
  registerChannelHandlers()
  registerChatHandlers()
  registerSettingsHandlers()
  registerSystemHandlers()
  registerAgentSessionHandlers()
  registerAgentWorkspaceHandlers()
  registerAgentPermissionHandlers()
  registerAgentFileHandlers()
  registerFeishuHandlers()
  registerIntegrationHandlers()
  registerMiscHandlers()

  console.log('[IPC] IPC 处理器注册完成')

  // 注册更新 IPC 处理器
  registerUpdaterIpc()

  // 启动时自动归档 + 每 24 小时定期检查
  const runAutoArchive = (): void => {
    try {
      const settings = getSettings()
      const days = settings.archiveAfterDays ?? 7
      if (days > 0) {
        const archivedChats = autoArchiveConversations(days)
        const archivedSessions = autoArchiveAgentSessions(days)
        if (archivedChats + archivedSessions > 0) {
          console.log(`[自动归档] 已归档 ${archivedChats} 个对话, ${archivedSessions} 个 Agent 会话`)
        }
      }
    } catch (error) {
      console.error('[自动归档] 自动归档失败:', error)
    }
  }

  runAutoArchive()
  setInterval(runAutoArchive, 24 * 60 * 60 * 1000)

  // 启动时自动清理临时文件
  const runStartupCleanup = async (): Promise<void> => {
    try {
      const settings = getSettings()
      if (settings.autoCleanupTempOnStart !== false) {
        const result = await cleanupTempFiles()
        if (result.freedBytes > 0) {
          console.log(`[存储清理] 启动时清理了 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB 临时文件`)
        }
      }
      const archiveDays = settings.autoCleanupArchivedDays ?? 0
      if (archiveDays > 0) {
        const result = await cleanupStorage({
          categories: ['agent-sessions', 'sdk-config'],
          orphansOnly: false,
          archivedBeforeDays: archiveDays,
        })
        if (result.freedBytes > 0) {
          console.log(`[存储清理] 启动时清理了 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB 归档数据`)
        }
      }
    } catch (e) {
      console.error('[存储清理] 启动时清理失败:', e)
    }
  }
  runStartupCleanup()
}
