/**
 * Agent 渠道选择工具
 *
 * 统一收敛 Agent 模式可见的渠道筛选逻辑，避免把 OpenAI-compatible
 * 或 custom 渠道误暴露给只支持 Anthropic SDK 的 Agent 流程。
 */

import { isAgentCompatibleProvider } from '@proma/shared'
import type { Channel } from '@proma/shared'
import { logProjectInfo } from '@/lib/project-log'

/**
 * 计算 Agent 模式可见的渠道列表。
 *
 * 规则：
 * - 只保留已启用且兼容 Agent 的渠道
 * - 如果 settings.json 里配置了 Agent 白名单，则进一步按白名单过滤
 */
export function getAgentVisibleChannels(channels: Channel[], agentChannelIds: string[]): Channel[] {
  const compatibleChannels = channels.filter(
    (channel) => channel.enabled && isAgentCompatibleProvider(channel.provider),
  )
  logProjectInfo('MODEL-LOAD', 'Agent 可见渠道筛选', {
    totalChannelCount: channels.length,
    compatibleChannelIds: compatibleChannels.map((channel) => channel.id),
    agentChannelIds,
  })

  if (agentChannelIds.length === 0) {
    return compatibleChannels
  }

  const scopedChannels = compatibleChannels.filter((channel) => agentChannelIds.includes(channel.id))
  logProjectInfo('MODEL-LOAD', 'Agent 白名单筛选结果', {
    scopedChannelIds: scopedChannels.map((channel) => channel.id),
  })
  return scopedChannels.length > 0 ? scopedChannels : compatibleChannels
}

/** 获取 Agent 模式可见渠道 ID 列表 */
export function getAgentVisibleChannelIds(channels: Channel[], agentChannelIds: string[]): string[] {
  return getAgentVisibleChannels(channels, agentChannelIds).map((channel) => channel.id)
}
