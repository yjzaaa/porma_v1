import { afterEach, describe, expect, test } from 'bun:test'
import {
  isLocalOpenAICompatibleBaseUrl,
  resolveOpenAICompatibleFallbackModelId,
} from './openai-fallback'

const originalOpenAIModel = process.env.OPENAI_MODEL
const originalLLMModel = process.env.LLM_MODEL
const originalModel = process.env.MODEL

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

afterEach(() => {
  restoreEnv('OPENAI_MODEL', originalOpenAIModel)
  restoreEnv('LLM_MODEL', originalLLMModel)
  restoreEnv('MODEL', originalModel)
})

describe('OpenAI-compatible 模型兜底', () => {
  test('given local base url when resolving fallback then returns gpt-4o', () => {
    expect(isLocalOpenAICompatibleBaseUrl('http://10.83.18.24:8080/v1')).toBe(true)
    expect(resolveOpenAICompatibleFallbackModelId('http://10.83.18.24:8080/v1')).toBe('gpt-4o')
  })

  test('given env model when resolving fallback then env model wins', () => {
    process.env.OPENAI_MODEL = 'gpt-4.1'
    expect(resolveOpenAICompatibleFallbackModelId('http://10.83.18.24:8080/v1')).toBe('gpt-4.1')
  })
})
