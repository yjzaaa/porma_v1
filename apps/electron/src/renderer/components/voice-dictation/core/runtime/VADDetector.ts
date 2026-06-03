/**
 * 【第 2 层 - 运行时层】VADDetector 自适应语音活动检测器
 *
 * 基于能量阈值 + 自适应噪声底噪估计 + 挂尾保护的三态 VAD。
 *
 * 状态机：
 *   silence ──[连续 confirmFrames 帧超阈值]──→ speech
 *   speech  ──[1 帧低于阈值]────────────────→ hangover
 *   hangover──[重新超阈值]──────────────────→ speech
 *   hangover──[连续 hangoverFrames 帧低于阈值]─→ silence
 *
 * 设计要点：
 *   - 噪声底噪使用 EMA（指数移动平均）自适应更新，仅在学习阶段和非语音帧更新
 *   - 确认帧数防止噪声脉冲误触发（如关门声、键盘敲击）
 *   - 挂尾保护防止语速慢时尾音被截断
 *
 * @see ../types/panel.ts - PcmFrame 定义
 */

import type { PcmFrame } from '../../shared/types/panel'

/** VAD 内部状态 */
type VADState = 'silence' | 'speech' | 'hangover'

export class VADDetector {
  /** 自适应噪声底噪估计（EMA） */
  private noiseFloor = 0.05
  /** 噪声学习率（越小学习越慢） */
  private readonly alpha = 0.01
  /** 语音阈值 = noiseFloor × thresholdMultiplier */
  private readonly thresholdMultiplier = 2.4
  /** 确认语音所需的连续超阈值帧数 */
  private readonly confirmFrames = 2
  /** 挂尾帧数（超过此值才宣布沉默结束） */
  private readonly hangoverFrames = 12

  /** VAD 内部状态 */
  private state: VADState = 'silence'
  /** 当前连续超阈值帧计数 */
  private speechFrames = 0
  /** 当前连续低阈值帧计数（用于 hangover 状态计数） */
  private silentFrames = 0

  /** 是否处于语音状态（speech 或 hangover 都算） */
  get isSpeaking(): boolean {
    return this.state === 'speech' || this.state === 'hangover'
  }

  /** 是否刚进入语音状态（silence → speech 的瞬间） */
  get onSpeechStart(): boolean {
    return this._onSpeechStart
  }
  private _onSpeechStart = false

  /** 是否刚结束语音（hangover → silence 的瞬间） */
  get onSpeechEnd(): boolean {
    return this._onSpeechEnd
  }
  private _onSpeechEnd = false

  /**
   * 处理一帧音频，更新 VAD 状态
   *
   * @param frame - PCM 帧（使用 peak 字段判断能量）
   *
   * 调用频率：每秒 ~23 次（2048 帧 @ 48kHz）
   * 每次调用后读取 isSpeaking / onSpeechStart / onSpeechEnd 获取结果。
   */
  process(frame: PcmFrame): void {
    // 重置单帧信号
    this._onSpeechStart = false
    this._onSpeechEnd = false

    // 步骤 1: 自适应噪声底噪估计
    // 仅在当前帧能量低（认为是噪音）时更新，避免将语音纳入噪声统计
    if (frame.peak < this.noiseFloor * 1.5) {
      this.noiseFloor += (frame.peak - this.noiseFloor) * this.alpha
      // 防止噪声底噪降到零
      if (this.noiseFloor < 0.001) this.noiseFloor = 0.001
    }

    const threshold = this.noiseFloor * this.thresholdMultiplier
    const isLoud = frame.peak >= threshold

    // 步骤 2: 状态机
    switch (this.state) {
      case 'silence':
        this.silentFrames = 0
        if (isLoud) {
          this.speechFrames++
          if (this.speechFrames >= this.confirmFrames) {
            this.state = 'speech'
            this.speechFrames = 0
            this._onSpeechStart = true
          }
        } else {
          this.speechFrames = 0
        }
        break

      case 'speech':
        if (isLoud) {
          // 持续语音，重置 silent 计数
          this.silentFrames = 0
        } else {
          // 出现沉默 → 进入 hangover
          this.state = 'hangover'
          this.silentFrames = 1
        }
        break

      case 'hangover':
        if (isLoud) {
          // 声音恢复 → 回到 speech
          this.state = 'speech'
          this.silentFrames = 0
        } else {
          this.silentFrames++
          if (this.silentFrames >= this.hangoverFrames) {
            this.state = 'silence'
            this.silentFrames = 0
            this._onSpeechEnd = true
          }
        }
        break
    }
  }

  /** 重置 VAD 状态到初始值 */
  reset(): void {
    this.noiseFloor = 0.05
    this.state = 'silence'
    this.speechFrames = 0
    this.silentFrames = 0
    this._onSpeechStart = false
    this._onSpeechEnd = false
  }
}
