/**
 * 语音模块 — 智能识别与决策类型
 *
 * 提供 ASR 结果、Agent 上下文、决策输出等跨层共享契约。
 */

/** 统一的语音识别结果接口 */
export interface UnifiedASRResult {
  /** 识别文本 */
  text: string
  /** 是否最终结果 */
  isFinal: boolean
  /** 置信度 (0-1) */
  confidence: number
  /** 智能判断的完整性 */
  isComplete: boolean
  /** ASR 类型标识 */
  asrType: 'doubao' | 'webspeech'
  /** 差异化元数据 */
  metadata: {
    /** definite 字段（仅豆包） */
    definite?: boolean
    /** utterances 信息（仅豆包） */
    utterances?: Array<{ text: string; definite: boolean }>
    /** 临时文本（仅 WebSpeech） */
    interimText?: string
    /** 结果索引（仅 WebSpeech） */
    resultIndex?: number
  }
}

/** Agent 循环状态 */
export enum AgentLoopState {
  PRE_USER_INPUT = 'pre_user_input',
  LLM_PROCESSING = 'llm_processing',
  TOOL_EXECUTING = 'tool_executing',
  POST_PROCESSING = 'post_processing',
  ERROR_STATE = 'error_state',
  UNKNOWN = 'unknown'
}

/** 语音自动发送模式 */
export type AutoSendMode = 'always' | 'smart' | 'ai'

/** 语音发送策略 */
export type VoiceSendStrategy = 'immediate' | 'wait' | 'interrupt' | 'continue'

/** Agent 上下文信息 */
export interface AgentContext {
  mode: 'agent' | 'chat'
  state: string
  recentMessages: string[]
  activeToolCalls: string[]
  loopState: AgentLoopState
  canAcceptInput: boolean
  lastUserMessageTime: number
}

/** 智能决策结果 */
export interface IntelligentDecision {
  shouldSend: boolean
  sendStrategy: VoiceSendStrategy
  confidence: number
  reasoning: string
}

/** 日志相关上下文 */
export interface LogContext {
  module: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  timestamp: string
  data?: unknown
}
