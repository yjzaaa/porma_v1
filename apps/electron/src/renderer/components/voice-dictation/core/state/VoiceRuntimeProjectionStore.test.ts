import { describe, expect, test } from 'bun:test'
import { VoiceRuntimeProjectionStore } from './VoiceRuntimeProjectionStore'

describe('VoiceRuntimeProjectionStore', () => {
  test('会返回独立的投影快照', () => {
    const store = new VoiceRuntimeProjectionStore()
    store.update({ transcript: 'hello', message: 'ready', volume: 0.6 })

    const snapshot = store.getSnapshot()
    snapshot.transcript = 'mutated'

    expect(store.getSnapshot().transcript).toBe('hello')
  })

  test('会基于快照构造状态转换上下文', () => {
    const store = new VoiceRuntimeProjectionStore()
    store.update({ currentAgentSessionId: 'session-1', transcript: '你好', message: '准备' })

    const context = store.createTransitionContext('测试')

    expect(context.sessionId).toBe('session-1')
    expect(context.transcript).toBe('你好')
    expect(context.message).toBe('准备')
    expect(context.reason).toBe('测试')
  })
})
