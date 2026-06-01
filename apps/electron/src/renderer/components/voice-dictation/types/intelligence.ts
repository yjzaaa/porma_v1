/**
 * 智能语音识别接口定义
 * 支持豆包ASR和WebSpeech的差异化处理
 */

/**
 * 统一的语音识别结果接口
 * 适配豆包ASR和WebSpeech的不同能力
 */
export interface UnifiedASRResult {
  // 基础字段
  text: string                    // 识别文本
  isFinal: boolean               // 是否最终结果
  confidence: number             // 置信度 (0-1)
  isComplete: boolean           // 智能判断的完整性

  // ASR类型标识
  asrType: 'doubao' | 'webspeech'

  // 元数据（差异化信息）
  metadata: {
    // 豆包ASR特有字段
    definite?: boolean           // definite字段（仅豆包）
    utterances?: Array<{text: string, definite: boolean}>

    // WebSpeech特有字段
    interimText?: string        // 临时文本（仅WebSpeech）
    resultIndex?: number        // 结果索引（仅WebSpeech）
  }
}

/**
 * Agent循环状态
 */
export enum AgentLoopState {
  PRE_USER_INPUT = 'pre_user_input',
  LLM_PROCESSING = 'llm_processing',
  TOOL_EXECUTING = 'tool_executing',
  POST_PROCESSING = 'post_processing',
  ERROR_STATE = 'error_state',
  UNKNOWN = 'unknown'
}

/**
 * Agent上下文信息
 */
export interface AgentContext {
  mode: 'agent' | 'chat'
  state: string
  recentMessages: string[]
  activeToolCalls: string[]
  loopState: AgentLoopState
  canAcceptInput: boolean
  lastUserMessageTime: number
}

/**
 * 智能决策结果
 */
export interface IntelligentDecision {
  shouldSend: boolean
  sendStrategy: 'immediate' | 'wait' | 'interrupt' | 'continue'
  confidence: number
  reasoning: string
}

/**
 * 日志相关类型
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogContext {
  module: string
  level: LogLevel
  timestamp: string
  data?: any
}
