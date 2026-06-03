import { describe, expect, test } from 'bun:test'
import { isCompleteAsrResult, shouldPromoteWebSpeechInterimToFinal } from './completion'

describe('ASR completion helpers', () => {
  test('会识别完整句子', () => {
    expect(shouldPromoteWebSpeechInterimToFinal('请帮我总结一下这段话。')).toBe(true)
  })

  test('会识别未完成文本', () => {
    expect(shouldPromoteWebSpeechInterimToFinal('帮我看看这个')).toBe(false)
  })

  test('会识别统一 ASR 完整性', () => {
    expect(
      isCompleteAsrResult({
        text: '你好，世界。',
        isFinal: true,
        confidence: 0.8,
        isComplete: false,
        asrType: 'webspeech',
        metadata: {},
      }),
    ).toBe(true)
  })
})
