/**
 * 语音领域事件总线（统一发布/订阅 seam）
 */

import type { VoiceDictationSettings } from '@/types/settings'
import type { ASRProvider } from '../../types/asr'
import type { IntelligentDecision } from '../../types/intelligence'

export interface AgentStateUpdatePayload {
  /** 当前模式（Agent / Chat） */
  mode?: 'agent' | 'chat'
  /** Agent 状态描述 */
  status?: string
  /** 流式执行状态快照 */
  streamingState?: { running: boolean; content: string; toolActivities: string[] }
  /** 是否处于错误态 */
  hasError?: boolean
  /** 最近消息窗口 */
  recentMessages?: string[]
  /** 最近用户消息时间戳 */
  lastUserMessageTime?: number
}

/**
 * 语音领域事件契约
 *
 * 分组约定：
 * - command.*：外部命令入口（通常由 Facade 发布）
 * - handsfree.*：采集模块的免提生命周期
 * - session.*：录音会话生命周期
 * - decision.*：智能决策链路
 */
export interface VoiceDomainEventMap {
  'command.toggle_handsfree': { settings: VoiceDictationSettings }
  'command.stop_recording': undefined
  'command.update_agent_state': AgentStateUpdatePayload
  'command.add_recent_message': { message: string }
  'command.set_agent_session_id': { sessionId: string | null }
  'command.destroy': undefined

  'handsfree.enabled': { settings: VoiceDictationSettings }
  'handsfree.disabled': undefined
  'handsfree.failed': { message: string; error?: unknown }

  'session.started': { engine: string }
  'session.volume': { peak: number }
  'session.transcript': { text: string; isFinal?: boolean; provider: ASRProvider }
  'session.metadata': { message: string }
  'session.complete': { text: string; commitMessage: string }
  'session.error': { message: string }

  'decision.feedback': { reasoning: string; strategy: IntelligentDecision['sendStrategy'] }
  'decision.execute': { decision: IntelligentDecision; text: string }

  'action.send_voice_text': { text: string; reasoning: string }
  'action.handle_immediate_instruction': { command: string; reasoning: string }
}

export type VoiceDomainEventType = keyof VoiceDomainEventMap
export type VoiceDomainEventListener<K extends VoiceDomainEventType> = (
  payload: VoiceDomainEventMap[K],
) => void

/**
 * 统一事件总线
 */
export class VoiceDomainEventBus {
  private readonly listeners: {
    [K in VoiceDomainEventType]: Set<VoiceDomainEventListener<K>>
  } = {
      'command.toggle_handsfree': new Set(),
      'command.stop_recording': new Set(),
      'command.update_agent_state': new Set(),
      'command.add_recent_message': new Set(),
      'command.set_agent_session_id': new Set(),
      'command.destroy': new Set(),

      'handsfree.enabled': new Set(),
      'handsfree.disabled': new Set(),
      'handsfree.failed': new Set(),

      'session.started': new Set(),
      'session.volume': new Set(),
      'session.transcript': new Set(),
      'session.metadata': new Set(),
      'session.complete': new Set(),
      'session.error': new Set(),

      'decision.feedback': new Set(),
      'decision.execute': new Set(),

      'action.send_voice_text': new Set(),
      'action.handle_immediate_instruction': new Set(),
    }

  /**
   * 订阅指定事件
   *
   * @returns 取消订阅函数
   */
  on<K extends VoiceDomainEventType>(event: K, listener: VoiceDomainEventListener<K>): () => void {
    const set = this.listeners[event]
    set.add(listener)
    return () => set.delete(listener)
  }

  /**
   * 发布指定事件
   */
  emit<K extends VoiceDomainEventType>(event: K, payload: VoiceDomainEventMap[K]): void {
    const set = this.listeners[event]
    for (const listener of set) {
      listener(payload)
    }
  }

  /**
   * 清空所有事件监听器
   */
  clear(): void {
    ;(Object.keys(this.listeners) as VoiceDomainEventType[]).forEach((key) => {
      this.listeners[key].clear()
    })
  }
}
