/**
 * 语音运行时投影存储
 *
 * 负责统一维护运行时投影快照，并提供基于快照构造状态转换上下文的能力。
 */

import type { VoiceDictationSettings } from '@/types/settings'
import type { StateTransitionContext } from './VoiceStateMachine'
import type { VoiceRuntimeProjectionState } from './VoiceRuntimeProjection'
import { createInitialVoiceRuntimeProjection } from './VoiceRuntimeProjection'

/**
 * 运行时投影存储
 */
export class VoiceRuntimeProjectionStore {
  private projection: VoiceRuntimeProjectionState = createInitialVoiceRuntimeProjection()

  /**
   * 获取当前投影快照
   */
  getSnapshot(): VoiceRuntimeProjectionState {
    return { ...this.projection }
  }

  /**
   * 批量更新投影快照
   */
  update(patch: Partial<VoiceRuntimeProjectionState>): VoiceRuntimeProjectionState {
    this.projection = { ...this.projection, ...patch }
    return this.getSnapshot()
  }

  /**
   * 写入转写文本和提示消息
   */
  setTranscriptAndMessage(transcript: string, message: string): VoiceRuntimeProjectionState {
    return this.update({ transcript, message })
  }

  /**
   * 是否启用免提
   */
  isHandsfreeEnabled(): boolean {
    return this.projection.settings?.handsfreeEnabled === true
  }

  /**
   * 读取当前设置
   */
  getSettings(): VoiceDictationSettings | null {
    return this.projection.settings
  }

  /**
   * 构造状态转换上下文
   */
  createTransitionContext(reason: string, overrides?: Partial<StateTransitionContext>): StateTransitionContext {
    return {
      sessionId: this.projection.currentAgentSessionId,
      transcript: this.projection.transcript,
      message: this.projection.message,
      volume: this.projection.volume,
      settings: this.projection.settings,
      reason,
      ...overrides,
    }
  }
}
