import { describe, expect, test } from 'bun:test'
import {
  buildOpenAICompatiblePresetChannel,
  hasOpenAICompatiblePresetChannel,
  isLocalOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleChannel,
  resolveOpenAICompatibleFallbackModelId,
} from './openai-fallback'

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

describe('OpenAI-compatible 模型兜底', () => {
  test('given local base url when resolving fallback then returns gpt-4o', () => {
    expect(isLocalOpenAICompatibleBaseUrl('http://10.83.18.24:8080/v1')).toBe(true)
    expect(resolveOpenAICompatibleFallbackModelId('http://10.83.18.24:8080/v1')).toBe('gpt-4o')
  })

  test('given env model when resolving fallback then env model wins', () => {
    const prev = process.env.OPENAI_MODEL
    process.env.OPENAI_MODEL = 'gpt-4.1'
    expect(resolveOpenAICompatibleFallbackModelId('http://10.83.18.24:8080/v1')).toBe('gpt-4.1')
    restoreEnv('OPENAI_MODEL', prev)
  })

  test('given local base url when building preset then returns usable custom channel', () => {
    const channel = buildOpenAICompatiblePresetChannel('http://10.83.18.24:8080/v1')
    expect(channel?.provider).toBe('custom')
    expect(channel?.models[0]?.id).toBe('gpt-4o')
    expect(channel?.enabled).toBe(true)
  })

  test('given preset channel when checking existing channels then detects preset', () => {
    const channel = buildOpenAICompatiblePresetChannel('http://10.83.18.24:8080/v1')
    expect(channel).not.toBeNull()
    expect(hasOpenAICompatiblePresetChannel(channel ? [channel] : [], 'http://10.83.18.24:8080/v1')).toBe(true)
  })

  test('given duplicated disabled local models when normalizing then keeps one enabled fallback', () => {
    const channel = normalizeOpenAICompatibleChannel({
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
    })

    expect(channel.models).toEqual([{ id: 'gpt-4o', name: 'gpt-4o', enabled: true }])
  })
})
