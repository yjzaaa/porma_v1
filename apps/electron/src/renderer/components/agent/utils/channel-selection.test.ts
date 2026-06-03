import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import { getAgentVisibleChannelIds, getAgentVisibleChannels } from './channel-selection'

function createChannel(id: string, provider: Channel['provider'], enabled = true): Channel {
  return {
    id,
    name: id,
    provider,
    baseUrl: 'https://example.com',
    apiKey: '',
    models: [{ id: `${id}-model`, name: `${id}-model`, enabled: true }],
    enabled,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('Agent 渠道选择过滤', () => {
  test('given mixed providers when filtering then only Agent-compatible channels remain', () => {
    const channels = [
      createChannel('anthropic-1', 'anthropic'),
      createChannel('custom-1', 'custom'),
      createChannel('openai-1', 'openai'),
      createChannel('deepseek-1', 'deepseek'),
      createChannel('disabled-1', 'minimax', false),
    ]

    const visible = getAgentVisibleChannels(channels, [])

    expect(visible.map((channel) => channel.id)).toEqual(['anthropic-1', 'deepseek-1'])
  })

  test('given invalid Agent white list when filtering then it falls back to all compatible channels', () => {
    const channels = [
      createChannel('anthropic-1', 'anthropic'),
      createChannel('custom-1', 'custom'),
      createChannel('deepseek-1', 'deepseek'),
    ]

    const visibleIds = getAgentVisibleChannelIds(channels, ['custom-1'])

    expect(visibleIds).toEqual(['anthropic-1', 'deepseek-1'])
  })
})
