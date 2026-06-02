export {
  VOICE_AUTO_SEND_REQUESTED_EVENT,
  VOICE_SETTINGS_CHANGED_EVENT,
  emitVoiceAutoSendRequested,
  onVoiceAutoSendRequested,
  emitVoiceSettingsChanged,
  onVoiceSettingsChanged,
} from './voice-dictation-events'

export type {
  VoiceAutoSendRequestedDetail,
} from './voice-dictation-events'

export {
  createVoiceEventLogger,
  VoiceLogEventEmitter,
  VoiceLogEventSubscriber,
} from './log-events'

export type {
  VoiceEventLogger,
  VoiceLogLevel,
  VoiceLogEvent,
  VoiceLogEventListener,
} from './log-events'
