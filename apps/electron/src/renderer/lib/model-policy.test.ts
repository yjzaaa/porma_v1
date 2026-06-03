import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import {
  buildModelOptions,
  mergeChannelsById,
  resolvePreferredChatModel,
  isLocalOpenAICompatibleBaseUrl,
} from './model-policy'

function createChannel(
  id: string,
  name: string,
  provider: Channel['provider'],
  baseUrl: string,
  modelId: string,
): Channel {
  return {
    id,
    name,
    provider,
    baseUrl,
    apiKey: '',
    models: [{ id: modelId, name: modelId, enabled: true }],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('模型策略', () => {
  test('given local openai-compatible channel when resolving preferred model then local model wins', () => {
    const channels = [
      createChannel('deepseek-1', 'DeepSeek', 'deepseek', 'https://api.deepseek.com/anthropic', 'deepseek-v4-pro'),
      createChannel('custom-1', '本地网关', 'custom', 'http://10.83.18.24:8080/v1', 'gpt-4o'),
    ]

    expect(isLocalOpenAICompatibleBaseUrl('http://10.83.18.24:8080/v1')).toBe(true)
    expect(resolvePreferredChatModel(channels)).toEqual({
      channelId: 'custom-1',
      modelId: 'gpt-4o',
    })
  })

  test('given refreshed channels when merging then current local channel is preserved', () => {
    const merged = mergeChannelsById(
      [createChannel('local-1', '本地网关', 'custom', 'http://10.83.18.24:8080/v1', 'gpt-4o')],
      [createChannel('deepseek-1', 'DeepSeek', 'deepseek', 'https://api.deepseek.com/anthropic', 'deepseek-v4-pro')],
    )

    expect(merged.map((channel) => channel.id)).toEqual(['local-1', 'deepseek-1'])
  })

  test('given local channel without enabled models when building options then fallback model is included', () => {
    const options = buildModelOptions([
      {
        id: 'custom-1',
        name: '本地网关',
        provider: 'custom',
        baseUrl: 'http://10.83.18.24:8080/v1',
        apiKey: '',
        models: [{ id: 'gpt-4o', name: 'gpt-4o', enabled: false }],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(options).toEqual([
      {
        channelId: 'custom-1',
        channelName: '本地网关',
        modelId: 'gpt-4o',
        modelName: 'gpt-4o',
        provider: 'custom',
      },
    ])
  })
})
