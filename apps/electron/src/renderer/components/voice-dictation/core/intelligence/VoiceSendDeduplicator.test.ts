import { describe, expect, test } from 'bun:test'
import { VoiceSendDeduplicator } from './VoiceSendDeduplicator'

describe('VoiceSendDeduplicator', () => {
  test('会在 TTL 内跳过重复文本', () => {
    const deduplicator = new VoiceSendDeduplicator(4000)

    expect(deduplicator.shouldSkip('你好', 1000)).toBe(false)
    deduplicator.record('你好', 1000)
    expect(deduplicator.shouldSkip('你好', 2500)).toBe(true)
    expect(deduplicator.shouldSkip('你好', 6001)).toBe(false)
  })
})
