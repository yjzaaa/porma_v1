import { describe, expect, test } from 'bun:test'
import { AgentLoopState } from '../../shared/types/intelligence'
import { AgentStateMonitor } from './AgentStateMonitor'

describe('AgentStateMonitor', () => {
  test('会返回只读语音上下文快照', () => {
    const monitor = new AgentStateMonitor()
    monitor.updateAgentState({
      streamingState: {
        running: true,
        content: '处理中',
        toolActivities: ['web_search'],
      },
    })

    const snapshot = monitor.getCurrentContext()
    expect(snapshot.loopState).toBe(AgentLoopState.POST_PROCESSING)
    expect(snapshot.canAcceptInput).toBe(false)
    expect(snapshot.isBusy).toBe(true)

    ;(snapshot.recentMessages as string[]).push('污染快照')
    ;(snapshot.activeToolCalls as string[]).push('污染工具')

    const nextSnapshot = monitor.getCurrentContext()
    expect(nextSnapshot.recentMessages).toEqual([])
    expect(nextSnapshot.activeToolCalls).toEqual(['web_search'])

    monitor.dispose()
  })
})
