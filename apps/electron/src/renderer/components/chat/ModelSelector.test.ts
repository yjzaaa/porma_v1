import { describe, expect, test } from 'bun:test'
import { buildModelOptions } from './ModelSelector'

describe('ModelSelector 模型选项', () => {
  test('given local openai-compatible channel with disabled models then includes fallback model', () => {
    const options = buildModelOptions([
      {
        id: 'custom-1',
        name: '本地网关',
        provider: 'custom',
        baseUrl: 'http://10.83.18.24:8080/v1',
        apiKey: '',
        models: [
          { id: 'gpt-4o', name: 'gpt-4o', enabled: false },
          { id: 'gpt-4o', name: 'gpt-4o', enabled: false },
        ],
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

  test('given local and deepseek channels then local channel sorts first', () => {
    const options = buildModelOptions([
      {
        id: 'deepseek-1',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: '',
        models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true }],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'custom-1',
        name: '本地网关',
        provider: 'custom',
        baseUrl: 'http://10.83.18.24:8080/v1',
        apiKey: '',
        models: [{ id: 'gpt-4o', name: 'gpt-4o', enabled: true }],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(options[0]?.channelId).toBe('custom-1')
  })
})
