/**
 * 语音运行时投影状态
 *
 * 统一承载 UI 状态、当前设置和上下文信息，避免在模块里散落多个独立字段。
 */

import type { VoiceDictationSettings } from '@/types/settings'

/** 运行时投影快照 */
export interface VoiceRuntimeProjectionState {
  /** 当前语音设置快照 */
  settings: VoiceDictationSettings | null
  /** 当前 Agent 会话 ID */
  currentAgentSessionId: string | null
  /** 转写文本投影 */
  transcript: string
  /** 状态消息投影 */
  message: string
  /** 音量投影 */
  volume: number
}

/** 创建初始投影状态 */
export function createInitialVoiceRuntimeProjection(): VoiceRuntimeProjectionState {
  return {
    settings: null,
    currentAgentSessionId: null,
    transcript: '',
    message: '',
    volume: 0,
  }
}
