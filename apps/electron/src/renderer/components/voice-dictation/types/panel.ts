/**
 * 语音模块 — 面板状态与调度类型定义
 *
 * 集中定义 PanelState 有限状态机、PCM 音频帧、Session 生命周期回调、
 * UI 状态广播接口等整个语音模块共用的数据类型。
 *
 * 状态机拓扑（6 状态）：
 *   stopped → listening → recording → processing → completed
 *                            ↘            ↘
 *                              error → stopped
 *   所有非法转换由 VALID_TRANSITIONS 表守卫，配合 StateMachine 拒绝运行时竞态跳转。
 *
 * @see ../core/StateMachine.ts - 有限状态机实现
 * @see ../core/Orchestrator.ts - 状态机持有者与调度器
 */

import type { VoiceDictationSettings } from '../../../../types'

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

/**
 * 合法状态转换表（严格守卫）
 *
 * 每个状态只允许向下兼容和合理的转换，非法调用会被 StateMachine 拒绝并 warn。
 * 例如：stopped → recording 不允许（必须先经过 listening）
 */
export const VALID_TRANSITIONS: Record<PanelState, PanelState[]> = {
  /** 初始状态 / 空闲 → 可进入免提 listening */
  stopped:    ['listening'],
  /** 静听中（免提模式）→ 检测到语音开始录音 / 关闭免提 */
  listening:  ['recording', 'stopped'],
  /** 录音中 → 处理中（正常结束）/ 出错 / 取消 */
  recording:  ['processing', 'error', 'stopped'],
  /** 处理中（输出提交）→ 完成 / 出错 / 取消 */
  processing: ['completed', 'error', 'stopped'],
  /** 完成 → 回归空闲 */
  completed:  ['stopped'],
  /** 出错 → 回归空闲 */
  error:      ['stopped'],
}

/** 语音活动检测器内部状态 */
export type DetectorState = 'inactive' | 'listening' | 'hearing' | 'activating'

// ===== Session 层接口 =====

/** 单次录音会话的输出结果 */
export interface SessionResult {
  /** 最终识别的文本 */
  text: string
  /** 提交结果的描述消息（如 "已追加到输入框"） */
  commitMessage: string
}

/** Session 生命周期回调（由 Orchestrator 传入） */
export interface SessionCallbacks {
  /** 实时音量回调（0-1） */
  onVolume: (peak: number) => void
  /** 实时转写文本回调 */
  onTranscript: (text: string) => void
  /** 元信息更新（如 "正在连接 ASR..."、"缓存命中"） */
  onMetadata: (msg: string) => void
  /** 会话完成回调 */
  onComplete: (result: SessionResult) => void
  /** 错误回调 */
  onError: (msg: string) => void
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
