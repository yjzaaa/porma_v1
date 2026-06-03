import { describe, expect, test } from 'bun:test'
import { AgentLoopState, type UnifiedASRResult, type VoiceAgentContext } from '../../shared/types/intelligence'
import { shouldAutoSend } from '../../shared/utils/auto-send'
import { VoiceSpeechDecisionPolicy } from './VoiceSpeechDecisionPolicy'

const policy = new VoiceSpeechDecisionPolicy()

const createAgentContext = (loopState: AgentLoopState): VoiceAgentContext => ({
  mode: 'agent',
  state: 'idle',
  recentMessages: [],
  activeToolCalls: [],
  loopState,
  canAcceptInput: true,
  isBusy: loopState !== AgentLoopState.PRE_USER_INPUT && loopState !== AgentLoopState.ERROR_STATE,
  lastUserMessageTime: 0,
})

const createAsrResult = (overrides: Partial<UnifiedASRResult>): UnifiedASRResult => ({
  text: '',
  isFinal: false,
  confidence: 0.8,
  isComplete: false,
  asrType: 'doubao',
  metadata: {},
  ...overrides,
})

describe('VoiceSpeechDecisionPolicy', () => {
  test('会把即时指令识别为打断决策', () => {
    const decision = policy.makeDecision(
      createAsrResult({ text: '取消这次操作', isFinal: true, isComplete: true }),
      createAgentContext(AgentLoopState.PRE_USER_INPUT),
    )

    expect(decision.sendStrategy).toBe('interrupt')
    expect(decision.shouldSend).toBe(true)
  })

  test('会把完整语音在空闲状态下判定为立即发送', () => {
    const decision = policy.makeDecision(
      createAsrResult({ text: '你好，帮我总结一下。', isFinal: true, isComplete: false }),
      createAgentContext(AgentLoopState.PRE_USER_INPUT),
    )

    expect(decision.sendStrategy).toBe('immediate')
    expect(decision.shouldSend).toBe(true)
  })

  test('会在 Agent 忙碌时对重要消息给出打断决策', () => {
    const decision = policy.makeDecision(
      createAsrResult({ text: '这里有一个紧急问题需要处理。', isFinal: true, isComplete: true }),
      createAgentContext(AgentLoopState.LLM_PROCESSING),
    )

    expect(decision.sendStrategy).toBe('interrupt')
    expect(decision.shouldSend).toBe(true)
  })
})

describe('shouldAutoSend', () => {
  test('会在 smart 模式下识别完整句子', () => {
    expect(shouldAutoSend('请帮我整理这段内容。', true, 'smart')).toBe(true)
  })

  test('会在 smart 模式下拒绝未完成表达', () => {
    expect(shouldAutoSend('帮我看看这个', true, 'smart')).toBe(false)
  })
})
