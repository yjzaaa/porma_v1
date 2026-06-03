/**
 * 语音模块 — 面板状态与调度类型定义
 *
 * 集中定义 VoiceStateMachine 相关 UI 状态、PCM 音频帧、Session 生命周期结果、
 * UI 状态广播接口等整个语音模块共用的数据类型。
 *
 * 状态机拓扑（6 状态）：
 *   stopped → listening → recording → processing → completed
 *                            ↘            ↘
 *                              error → stopped
 *   所有非法转换由 VoiceStateMachine 守卫，拒绝运行时竞态跳转。
 *
 * @see ../core/state/VoiceStateMachine.ts - 有限状态机实现
 * @see ../core/orchestrator/Orchestrator.ts - 状态机持有者与调度器
 */

import type { VoiceDictationSettings } from '../../../../../types'

/** PCM 音频帧（16-bit 单声道），由 AudioHub 采集并广播给所有订阅者 */
export interface PcmFrame {
  /** 16-bit 有符号整数 PCM 数据缓冲区 */
  data: Int16Array
  /** 该帧的音频峰值（归一化 0-1） */
  peak: number
  /** 原始采样率（通常 48000 Hz） */
  sampleRate: number
}

/** PCM 帧订阅者类型 */
export type PcmSubscriber = (frame: PcmFrame) => void

/** 语音面板有效状态值 */
export type PanelState = 'stopped' | 'listening' | 'recording' | 'processing' | 'completed' | 'error'

/** 语音活动检测器内部状态 */
export type DetectorState = 'inactive' | 'listening' | 'hearing' | 'activating'

// ===== Session 层类型 =====

/** 单次录音会话的输出结果 */
export interface SessionResult {
  /** 最终识别的文本 */
  text: string
}

// ===== Orchestrator → UI 层接口 =====

/** Orchestrator 广播给 UI 层的快照状态 */
export interface VoiceUIState {
  /** 面板当前状态 */
  state: PanelState
  /** 实时音量（0-1） */
  volume: number
  /** 当前转写文本 */
  transcript: string
  /** 状态描述消息 */
  message: string
  /** 当前语音设置快照 */
  settings: VoiceDictationSettings | null
}

/** UI 状态变更监听器 */
export type UIStateListener = (s: VoiceUIState) => void
