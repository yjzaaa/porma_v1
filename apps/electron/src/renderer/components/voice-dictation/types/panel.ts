/**
 * 语音模块 — 面板与调度类型
 *
 * PanelState 状态机定义、PCM 帧类型、Session/UI 通信接口。
 */

import type { VoiceDictationSettings } from '../../../../types'

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

/** 语音面板合法状态 */
export type PanelState = 'stopped' | 'listening' | 'recording' | 'processing' | 'completed' | 'error'

/** 状态转换表 */
export const VALID_TRANSITIONS: Record<PanelState, PanelState[]> = {
  stopped:    ['listening'],
  listening:  ['recording', 'stopped'],
  recording:  ['processing', 'error', 'stopped'],
  processing: ['completed', 'error', 'stopped'],
  completed:  ['stopped'],
  error:      ['stopped'],
}

/** 语音活动检测器状态 */
export type DetectorState = 'inactive' | 'listening' | 'hearing' | 'activating'

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

export interface VoiceUIState {
  state: PanelState
  volume: number
  transcript: string
  message: string
  settings: VoiceDictationSettings | null
}

export type UIStateListener = (s: VoiceUIState) => void
