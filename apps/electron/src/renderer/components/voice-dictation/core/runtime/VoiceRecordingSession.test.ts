import { describe, expect, test } from 'bun:test'
import type { ASREvent, ASRProvider, ASREventListener } from '../../shared/types/asr'
import type { PcmFrame } from '../../shared/types/panel'
import { VoiceRecordingSession } from './VoiceRecordingSession'

class FakeASRProvider implements ASRProvider {
  private readonly listeners = new Set<ASREventListener>()
  startCount = 0
  stopCount = 0
  cancelCount = 0

  onEvent(listener: ASREventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    this.startCount += 1
    this.emit({ type: 'state', state: 'ready', message: 'ready' })
  }

  pushAudio(_frame: PcmFrame): void {}

  async stop(): Promise<string> {
    this.stopCount += 1
    this.emit({ type: 'end', text: '最终文本' })
    return '最终文本'
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1
  }

  dispose(): void {}

  emit(event: ASREvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

describe('VoiceRecordingSession', () => {
  test('会限制重复启动', async () => {
    const provider = new FakeASRProvider()
    const session = new VoiceRecordingSession(provider)

    await session.start()
    await session.start()

    expect(provider.startCount).toBe(1)
    expect(session.state).toBe('recording')
  })

  test('会在 stop 后等待外部收尾', async () => {
    const provider = new FakeASRProvider()
    const session = new VoiceRecordingSession(provider)

    await session.start()
    const stopText = await session.stop()
    expect(stopText).toBe('最终文本')
    expect(session.state).toBe('completed')
    expect(session.settled).toBe(false)

    session.settle()
    await session.waitUntilSettled()
    expect(session.settled).toBe(true)
  })

  test('会在 cancel 后立即收尾', async () => {
    const provider = new FakeASRProvider()
    const session = new VoiceRecordingSession(provider)

    await session.start()
    session.cancel()

    expect(provider.cancelCount).toBe(1)
    expect(session.state).toBe('cancelled')
    expect(session.settled).toBe(true)
  })
})
