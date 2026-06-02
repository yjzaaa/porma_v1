/**
 * 语音领域事件总线（统一发布/订阅 seam）
 */

import type { VoiceDictationSettings } from '@/types/settings'
import type { ASRProvider } from '../../types/asr'
import type { IntelligentDecision } from '../../types/intelligence'
import {
  VOICE_ACTION_HANDLE_IMMEDIATE_INSTRUCTION_EVENT,
  VOICE_ACTION_SEND_VOICE_TEXT_EVENT,
  VOICE_UI_AUTO_SEND_REQUESTED_EVENT,
  VOICE_COMMAND_ADD_RECENT_MESSAGE_EVENT,
  VOICE_COMMAND_DESTROY_EVENT,
  VOICE_COMMAND_SET_AGENT_SESSION_ID_EVENT,
  VOICE_COMMAND_STOP_RECORDING_EVENT,
  VOICE_COMMAND_TOGGLE_HANDSFREE_EVENT,
  VOICE_COMMAND_UPDATE_AGENT_STATE_EVENT,
  VOICE_DECISION_EXECUTE_EVENT,
  VOICE_DECISION_FEEDBACK_EVENT,
  VOICE_HANDSFREE_DISABLED_EVENT,
  VOICE_HANDSFREE_ENABLED_EVENT,
  VOICE_HANDSFREE_FAILED_EVENT,
  VOICE_SESSION_COMPLETE_EVENT,
  VOICE_SESSION_ERROR_EVENT,
  VOICE_SESSION_METADATA_EVENT,
  VOICE_SESSION_STARTED_EVENT,
  VOICE_SESSION_TRANSCRIPT_EVENT,
  VOICE_SESSION_VOLUME_EVENT,
  VOICE_DOMAIN_EVENT_KEYS,
} from './VoiceDomainEventKeys'

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
  /** 切换免提录音 */
  [VOICE_COMMAND_TOGGLE_HANDSFREE_EVENT]: { settings: VoiceDictationSettings }
  /** 停止当前录音 */
  [VOICE_COMMAND_STOP_RECORDING_EVENT]: undefined
  /** 更新 Agent 状态快照 */
  [VOICE_COMMAND_UPDATE_AGENT_STATE_EVENT]: AgentStateUpdatePayload
  /** 追加最近一条消息 */
  [VOICE_COMMAND_ADD_RECENT_MESSAGE_EVENT]: { message: string }
  /** 设置当前 Agent 会话 ID */
  [VOICE_COMMAND_SET_AGENT_SESSION_ID_EVENT]: { sessionId: string | null }
  /** 销毁语音模块 */
  [VOICE_COMMAND_DESTROY_EVENT]: undefined

  /** 免提已启用 */
  [VOICE_HANDSFREE_ENABLED_EVENT]: { settings: VoiceDictationSettings }
  /** 免提已关闭 */
  [VOICE_HANDSFREE_DISABLED_EVENT]: undefined
  /** 免提启用失败 */
  [VOICE_HANDSFREE_FAILED_EVENT]: { message: string; error?: unknown }

  /** 录音会话已开始 */
  [VOICE_SESSION_STARTED_EVENT]: { engine: string }
  /** 录音音量变化 */
  [VOICE_SESSION_VOLUME_EVENT]: { peak: number }
  /** 录音转写结果 */
  [VOICE_SESSION_TRANSCRIPT_EVENT]: { text: string; isFinal?: boolean; provider: ASRProvider }
  /** 录音会话元数据 */
  [VOICE_SESSION_METADATA_EVENT]: { message: string }
  /** 录音会话完成 */
  [VOICE_SESSION_COMPLETE_EVENT]: { text: string; commitMessage: string }
  /** 录音会话出错 */
  [VOICE_SESSION_ERROR_EVENT]: { message: string }

  /** 决策反馈 */
  [VOICE_DECISION_FEEDBACK_EVENT]: { reasoning: string; strategy: IntelligentDecision['sendStrategy'] }
  /** 决策执行 */
  [VOICE_DECISION_EXECUTE_EVENT]: { decision: IntelligentDecision; text: string }

  /** 发送语音文本 */
  [VOICE_ACTION_SEND_VOICE_TEXT_EVENT]: { text: string; reasoning: string }
  /** 处理即时指令 */
  [VOICE_ACTION_HANDLE_IMMEDIATE_INSTRUCTION_EVENT]: { command: string; reasoning: string }
  /** UI 自动发送请求（桥接到 window 事件） */
  [VOICE_UI_AUTO_SEND_REQUESTED_EVENT]: { text: string }
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
      [VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.command.stopRecording]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.command.updateAgentState]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.command.addRecentMessage]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.command.setAgentSessionId]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.command.destroy]: new Set(),

      [VOICE_DOMAIN_EVENT_KEYS.handsfree.enabled]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.handsfree.disabled]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.handsfree.failed]: new Set(),

      [VOICE_DOMAIN_EVENT_KEYS.session.started]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.session.volume]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.session.transcript]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.session.metadata]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.session.complete]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.session.error]: new Set(),

      [VOICE_DOMAIN_EVENT_KEYS.decision.feedback]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.decision.execute]: new Set(),

      [VOICE_DOMAIN_EVENT_KEYS.action.sendVoiceText]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.action.handleImmediateInstruction]: new Set(),
      [VOICE_DOMAIN_EVENT_KEYS.ui.autoSendRequested]: new Set(),
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
