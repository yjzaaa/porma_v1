/**
 * 语音模块架构 — 共享类型
 *
 * 核心设计原则：
 *   AudioHub 单例 → 订阅者模式 → VAD / Session 各自订阅 PCM
 *   StateMachine → 严格守卫 → 防止重复触发
 *   Session → 自包含 → 不泄漏 ref 到下一轮
 */

import type { VoiceDictationSettings } from '../../../../types'

// ===== AudioHub =====

/** PCM 帧（16-bit 单声道），由 AudioHub 广播 */
export interface PcmFrame {
  /** 16-bit PCM Int16Array */
  data: Int16Array
  /** 峰值（0-1） */
  peak: number
  /** 采样率 */
  sampleRate: number
}

export type PcmSubscriber = (frame: PcmFrame) => void

// ===== StateMachine =====

/** 语音面板合法状态 */
export type PanelState = 'stopped' | 'listening' | 'recording' | 'processing' | 'completed' | 'error'

/** 状态转换表 */
export const VALID_TRANSITIONS: Record<PanelState, PanelState[]> = {
  stopped:    ['listening'],
  listening:  ['recording', 'stopped'],
  recording:  ['processing', 'error', 'stopped'],  // 允许紧急停止
  processing: ['completed', 'error', 'stopped'],    // 允许紧急停止
  completed:  ['stopped'],
  error:      ['stopped'],
}

// ===== Session =====

export interface SessionResult {
  text: string
  commitMessage: string
}

export interface SessionCallbacks {
  onVolume: (peak: number) => void
  onTranscript: (text: string) => void
  onMetadata: (msg: string) => void
  onComplete: (result: SessionResult) => void
  onError: (msg: string) => void
}

// ===== Orchestrator =====

/** 供 UI 消费的 ObservableState */
export interface VoiceUIState {
  state: PanelState
  volume: number
  transcript: string
  message: string
  settings: VoiceDictationSettings | null
}

export type UIStateListener = (s: VoiceUIState) => void
