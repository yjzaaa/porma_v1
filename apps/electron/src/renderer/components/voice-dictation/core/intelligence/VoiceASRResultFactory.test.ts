import { describe, expect, test } from 'bun:test'
import type { ASRProvider } from '../../shared/types/asr'
import { VoiceASRResultFactory } from './VoiceASRResultFactory'

class FakeProvider implements ASRProvider {
  onEvent(): () => void {
    return () => {}
  }

  async start(): Promise<void> {}

  pushAudio(): void {}

  async stop(): Promise<string> {
    return ''
  }

  async cancel(): Promise<void> {}

  dispose(): void {}

  getCurrentRecognitionDetails() {
    return {
      definite: true,
      utterances: [{ text: '你好', definite: true }],
    }
  }
}

describe('VoiceASRResultFactory', () => {
  test('会归一化 ASR 元数据', () => {
    const factory = new VoiceASRResultFactory()
    const result = factory.create('你好', true, 'doubao', new FakeProvider())

    expect(result.text).toBe('你好')
    expect(result.isFinal).toBe(true)
    expect(result.metadata.definite).toBe(true)
    expect(result.metadata.utterances?.[0]?.text).toBe('你好')
  })
})
