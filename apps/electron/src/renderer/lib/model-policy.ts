/**
 * 模型策略
 *
 * 统一封装 Chat/Agent 共享的模型排序、兜底与恢复规则。
 */

import type { Channel, ModelOption } from '@proma/shared'

/** Chat 模式的本地 OpenAI-compatible 默认模型 */
const DEFAULT_OPENAI_COMPATIBLE_MODEL_ID = 'gpt-4o'

/** 模型选择条目 */
export interface SelectedModelSnapshot {
  /** 渠道 ID */
  channelId: string
  /** 模型 ID */
  modelId: string
}

/**
 * 判断是否是本地 OpenAI-compatible 地址。
 *
 * 用于识别本地网关和内网代理，优先把它排到模型列表前面。
 */
export function isLocalOpenAICompatibleBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return false

  try {
    const host = new URL(normalized).hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
    const match172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
    if (match172) {
      const second = Number(match172[1])
      if (second >= 16 && second <= 31) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 解析 Chat 模式的兜底模型 ID。
 *
 * 优先读取本地存储，避免刷新渠道后把用户最后一次选择冲掉。
 */
export function resolveOpenAICompatibleFallbackModelId(): string {
  const storedModel = typeof localStorage === 'undefined'
    ? ''
    : (localStorage.getItem('proma-openai-model') ?? '').trim()

  return storedModel || DEFAULT_OPENAI_COMPATIBLE_MODEL_ID
}

/**
 * 获取渠道排序权重。
 *
 * 本地 OpenAI-compatible 渠道优先展示，方便用户快速选到 gpt-4o。
 */
export function getChannelSortWeight(channel: Channel): number {
  return isLocalOpenAICompatibleBaseUrl(channel.baseUrl) ? 0 : 1
}

/**
 * 按 ID 合并渠道列表。
 *
 * 先保留当前缓存，再用刷新结果覆盖同 ID 项，避免刷新时丢失本地渠道。
 */
export function mergeChannelsById(currentChannels: Channel[], refreshedChannels: Channel[]): Channel[] {
  const merged = new Map<string, Channel>()

  for (const channel of currentChannels) {
    merged.set(channel.id, channel)
  }

  for (const channel of refreshedChannels) {
    merged.set(channel.id, channel)
  }

  return Array.from(merged.values())
}

/**
 * 从渠道中找到首个可用的 Chat 模型。
 *
 * 优先本地 OpenAI-compatible 渠道；如果它没有可用模型，则补一个默认模型 ID。
 */
export function resolvePreferredChatModel(channels: Channel[]): SelectedModelSnapshot | null {
  const orderedChannels = [...channels].sort((a, b) => {
    const weightDiff = getChannelSortWeight(a) - getChannelSortWeight(b)
    if (weightDiff !== 0) return weightDiff
    return a.name.localeCompare(b.name)
  })

  for (const channel of orderedChannels) {
    if (!channel.enabled || !isLocalOpenAICompatibleBaseUrl(channel.baseUrl)) continue

    const enabledModel = channel.models.find((model) => model.enabled)
    if (enabledModel) {
      return {
        channelId: channel.id,
        modelId: enabledModel.id,
      }
    }

    return {
      channelId: channel.id,
      modelId: resolveOpenAICompatibleFallbackModelId(),
    }
  }

  const fallbackChannel = channels.find((channel) =>
    channel.enabled && channel.models.some((model) => model.enabled),
  )
  const fallbackModel = fallbackChannel?.models.find((model) => model.enabled)

  if (!fallbackChannel || !fallbackModel) return null

  return {
    channelId: fallbackChannel.id,
    modelId: fallbackModel.id,
  }
}

/**
 * 校验当前选择的模型是否仍然可用。
 */
export function isSelectedModelAvailable(channels: Channel[], selectedModel: SelectedModelSnapshot | null): boolean {
  if (!selectedModel) return false

  const selectedChannel = channels.find((channel) => channel.id === selectedModel.channelId)
  return selectedChannel?.enabled
    ? selectedChannel.models.some((model) => model.enabled && model.id === selectedModel.modelId)
    : false
}

/**
 * 从渠道列表构建扁平化的模型选项。
 */
export function buildModelOptions(channels: Channel[], filterChannelId?: string, filterChannelIds?: string[]): ModelOption[] {
  const options: ModelOption[] = []

  const orderedChannels = [...channels].sort((a, b) => {
    const weightDiff = getChannelSortWeight(a) - getChannelSortWeight(b)
    if (weightDiff !== 0) return weightDiff
    return a.name.localeCompare(b.name)
  })

  for (const channel of orderedChannels) {
    if (!channel.enabled) continue
    if (filterChannelId && channel.id !== filterChannelId) continue
    if (filterChannelIds && !filterChannelIds.includes(channel.id)) continue

    const beforeLength = options.length

    for (const model of channel.models) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
        provider: channel.provider,
      })
    }

    if (options.length === beforeLength && isLocalOpenAICompatibleBaseUrl(channel.baseUrl)) {
      const fallbackModelId = resolveOpenAICompatibleFallbackModelId()
      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: fallbackModelId,
        modelName: fallbackModelId,
        provider: channel.provider,
      })
    }
  }

  return options
}
