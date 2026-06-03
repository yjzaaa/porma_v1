/**
 * 语音领域事件 key 常量
 *
 * 这些常量会被事件总线、模块订阅、Orchestrator 调用和 UI 桥接同时引用，
 * 把注释放在定义处可以让 IDE 在任何引用点 hover 直接看到语义。
 */

/**
 * 切换免提录音的命令事件。
 */
export const VOICE_COMMAND_TOGGLE_HANDSFREE_EVENT = 'command.toggle_handsfree' as const
/**
 * 停止当前录音的命令事件。
 */
export const VOICE_COMMAND_STOP_RECORDING_EVENT = 'command.stop_recording' as const
/**
 * 取消当前录音会话的命令事件。
 */
export const VOICE_COMMAND_CANCEL_RECORDING_EVENT = 'command.cancel_recording' as const
/**
 * 更新 Agent 状态快照的命令事件。
 */
export const VOICE_COMMAND_UPDATE_AGENT_STATE_EVENT = 'command.update_agent_state' as const
/**
 * 追加最近一条消息的命令事件。
 */
export const VOICE_COMMAND_ADD_RECENT_MESSAGE_EVENT = 'command.add_recent_message' as const
/**
 * 设置当前 Agent 会话 ID 的命令事件。
 */
export const VOICE_COMMAND_SET_AGENT_SESSION_ID_EVENT = 'command.set_agent_session_id' as const
/**
 * 销毁整个语音模块的命令事件。
 */
export const VOICE_COMMAND_DESTROY_EVENT = 'command.destroy' as const
/**
 * 停止指定 Agent 会话的命令事件。
 */
export const VOICE_COMMAND_STOP_AGENT_EVENT = 'command.stop_agent' as const

/**
 * 免提模式已成功启用的事件。
 */
export const VOICE_HANDSFREE_ENABLED_EVENT = 'handsfree.enabled' as const
/**
 * 免提模式已关闭的事件。
 */
export const VOICE_HANDSFREE_DISABLED_EVENT = 'handsfree.disabled' as const
/**
 * 免提模式启用失败的事件。
 */
export const VOICE_HANDSFREE_FAILED_EVENT = 'handsfree.failed' as const

/**
 * 录音会话已开始的事件。
 */
export const VOICE_SESSION_STARTED_EVENT = 'session.started' as const
/**
 * 录音过程中的音量变化事件。
 */
export const VOICE_SESSION_VOLUME_EVENT = 'session.volume' as const
/**
 * 录音转写结果事件。
 */
export const VOICE_SESSION_TRANSCRIPT_EVENT = 'session.transcript' as const
/**
 * 录音会话元数据事件。
 */
export const VOICE_SESSION_METADATA_EVENT = 'session.metadata' as const
/**
 * 录音会话完成事件。
 */
export const VOICE_SESSION_COMPLETE_EVENT = 'session.complete' as const
/**
 * 录音会话错误事件。
 */
export const VOICE_SESSION_ERROR_EVENT = 'session.error' as const

/**
 * 智能决策反馈事件。
 */
export const VOICE_DECISION_FEEDBACK_EVENT = 'decision.feedback' as const
/**
 * 智能决策执行事件。
 */
export const VOICE_DECISION_EXECUTE_EVENT = 'decision.execute' as const

/**
 * 发送语音文本的动作事件。
 */
export const VOICE_ACTION_SEND_VOICE_TEXT_EVENT = 'action.send_voice_text' as const
/**
 * 处理即时指令的动作事件。
 */
export const VOICE_ACTION_HANDLE_IMMEDIATE_INSTRUCTION_EVENT = 'action.handle_immediate_instruction' as const
/**
 * UI 自动发送请求事件。
 */
export const VOICE_UI_AUTO_SEND_REQUESTED_EVENT = 'ui.auto_send_requested' as const

/**
 * 语音领域事件分组常量。
 *
 * 方便按类别访问事件 key，同时保留单独导出的字符串常量用于 hover 文档。
 */
export const VOICE_DOMAIN_EVENT_KEYS = {
  command: {
    toggleHandsfree: VOICE_COMMAND_TOGGLE_HANDSFREE_EVENT,
    stopRecording: VOICE_COMMAND_STOP_RECORDING_EVENT,
    cancelRecording: VOICE_COMMAND_CANCEL_RECORDING_EVENT,
    updateAgentState: VOICE_COMMAND_UPDATE_AGENT_STATE_EVENT,
    addRecentMessage: VOICE_COMMAND_ADD_RECENT_MESSAGE_EVENT,
    setAgentSessionId: VOICE_COMMAND_SET_AGENT_SESSION_ID_EVENT,
    destroy: VOICE_COMMAND_DESTROY_EVENT,
    stopAgent: VOICE_COMMAND_STOP_AGENT_EVENT,
  },
  handsfree: {
    enabled: VOICE_HANDSFREE_ENABLED_EVENT,
    disabled: VOICE_HANDSFREE_DISABLED_EVENT,
    failed: VOICE_HANDSFREE_FAILED_EVENT,
  },
  session: {
    started: VOICE_SESSION_STARTED_EVENT,
    volume: VOICE_SESSION_VOLUME_EVENT,
    transcript: VOICE_SESSION_TRANSCRIPT_EVENT,
    metadata: VOICE_SESSION_METADATA_EVENT,
    complete: VOICE_SESSION_COMPLETE_EVENT,
    error: VOICE_SESSION_ERROR_EVENT,
  },
  decision: {
    feedback: VOICE_DECISION_FEEDBACK_EVENT,
    execute: VOICE_DECISION_EXECUTE_EVENT,
  },
  action: {
    sendVoiceText: VOICE_ACTION_SEND_VOICE_TEXT_EVENT,
    handleImmediateInstruction: VOICE_ACTION_HANDLE_IMMEDIATE_INSTRUCTION_EVENT,
  },
  ui: {
    autoSendRequested: VOICE_UI_AUTO_SEND_REQUESTED_EVENT,
  },
} as const
