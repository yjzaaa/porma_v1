/**
 * 语音领域事件 key 常量
 */

export const VOICE_COMMAND_TOGGLE_HANDSFREE_EVENT = 'command.toggle_handsfree' as const
export const VOICE_COMMAND_STOP_RECORDING_EVENT = 'command.stop_recording' as const
export const VOICE_COMMAND_UPDATE_AGENT_STATE_EVENT = 'command.update_agent_state' as const
export const VOICE_COMMAND_ADD_RECENT_MESSAGE_EVENT = 'command.add_recent_message' as const
export const VOICE_COMMAND_SET_AGENT_SESSION_ID_EVENT = 'command.set_agent_session_id' as const
export const VOICE_COMMAND_DESTROY_EVENT = 'command.destroy' as const

export const VOICE_HANDSFREE_ENABLED_EVENT = 'handsfree.enabled' as const
export const VOICE_HANDSFREE_DISABLED_EVENT = 'handsfree.disabled' as const
export const VOICE_HANDSFREE_FAILED_EVENT = 'handsfree.failed' as const

export const VOICE_SESSION_STARTED_EVENT = 'session.started' as const
export const VOICE_SESSION_VOLUME_EVENT = 'session.volume' as const
export const VOICE_SESSION_TRANSCRIPT_EVENT = 'session.transcript' as const
export const VOICE_SESSION_METADATA_EVENT = 'session.metadata' as const
export const VOICE_SESSION_COMPLETE_EVENT = 'session.complete' as const
export const VOICE_SESSION_ERROR_EVENT = 'session.error' as const

export const VOICE_DECISION_FEEDBACK_EVENT = 'decision.feedback' as const
export const VOICE_DECISION_EXECUTE_EVENT = 'decision.execute' as const

export const VOICE_ACTION_SEND_VOICE_TEXT_EVENT = 'action.send_voice_text' as const
export const VOICE_ACTION_HANDLE_IMMEDIATE_INSTRUCTION_EVENT = 'action.handle_immediate_instruction' as const

export const VOICE_DOMAIN_EVENT_KEYS = {
  command: {
    toggleHandsfree: VOICE_COMMAND_TOGGLE_HANDSFREE_EVENT,
    stopRecording: VOICE_COMMAND_STOP_RECORDING_EVENT,
    updateAgentState: VOICE_COMMAND_UPDATE_AGENT_STATE_EVENT,
    addRecentMessage: VOICE_COMMAND_ADD_RECENT_MESSAGE_EVENT,
    setAgentSessionId: VOICE_COMMAND_SET_AGENT_SESSION_ID_EVENT,
    destroy: VOICE_COMMAND_DESTROY_EVENT,
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
} as const
