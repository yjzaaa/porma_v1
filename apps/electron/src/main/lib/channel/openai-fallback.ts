/**
 * OpenAI-compatible 模型兜底规则
 *
 * 纯函数模块，供渠道拉模型和测试使用。
 */

import { normalizeBaseUrl } from '@proma/core'
import type { Channel } from '@proma/shared'
import type { ChannelModel } from '@proma/shared'

/** 本地 OpenAI-compatible 接口的默认模型 */
const DEFAULT_LOCAL_OPENAI_MODEL_ID = 'gpt-4o'
/** 本地 OpenAI-compatible 预设渠道 ID */
export const OPENAI_LOCAL_PRESET_CHANNEL_ID = 'openai-local-preset'

/**
 * 判断是否是本地 OpenAI-compatible 地址。
 *
 * 用于在网关不提供 /models 时，自动补一个默认模型，避免模型选择器为空。
 */
export function isLocalOpenAICompatibleBaseUrl(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl)
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
 * 解析 OpenAI-compatible 的兜底模型 ID。
 *
 * 优先级：
 * 1. OPENAI_MODEL / LLM_MODEL / MODEL 环境变量
 * 2. 本地 OpenAI-compatible 地址默认补 gpt-4o
 */
export function resolveOpenAICompatibleFallbackModelId(baseUrl: string): string | null {
  const envModel = (process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? process.env.MODEL ?? '').trim()
  if (envModel) return envModel
  return isLocalOpenAICompatibleBaseUrl(baseUrl) ? DEFAULT_LOCAL_OPENAI_MODEL_ID : null
}

/**
 * 构建本地 OpenAI-compatible 预设渠道。
 *
 * 仅在检测到本地接口地址时使用，用于让模型选择器有一个真实可保存的渠道。
 */
export function buildOpenAICompatiblePresetChannel(baseUrl: string, now = Date.now()): Channel | null {
  if (!isLocalOpenAICompatibleBaseUrl(baseUrl)) return null
  const modelId = resolveOpenAICompatibleFallbackModelId(baseUrl)
  if (!modelId) return null

  return {
    id: OPENAI_LOCAL_PRESET_CHANNEL_ID,
    name: '本地 OpenAI 兼容',
    provider: 'custom',
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: '',
    models: [{ id: modelId, name: modelId, enabled: true }],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 判断现有渠道是否已经包含本地 OpenAI-compatible 预设。
 */
export function hasOpenAICompatiblePresetChannel(channels: Channel[], baseUrl: string): boolean {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  return channels.some((channel) =>
    channel.id === OPENAI_LOCAL_PRESET_CHANNEL_ID ||
    ((channel.provider === 'custom' || channel.provider === 'openai') && normalizeBaseUrl(channel.baseUrl) === normalizedBaseUrl)
  )
}

/**
 * 规范化本地 OpenAI-compatible 渠道。
 *
 * 目标：
 * - 去重同名模型
 * - 确保兜底模型存在且启用
 * - 避免历史脏数据把模型列表渲染成空
 */
export function normalizeOpenAICompatibleChannel(channel: Channel): Channel {
  if (!isLocalOpenAICompatibleBaseUrl(channel.baseUrl)) return channel

  const fallbackModelId = resolveOpenAICompatibleFallbackModelId(channel.baseUrl)
  if (!fallbackModelId) return channel

  const seen = new Set<string>()
  const models: ChannelModel[] = []

  for (const model of channel.models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    models.push({
      ...model,
      enabled: model.id === fallbackModelId ? true : model.enabled,
    })
  }

  if (!seen.has(fallbackModelId)) {
    models.push({ id: fallbackModelId, name: fallbackModelId, enabled: true })
  }

  return {
    ...channel,
    models,
    enabled: true,
  }
}
