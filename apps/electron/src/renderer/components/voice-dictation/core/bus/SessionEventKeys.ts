/**
 * Session 事件 key 常量
 */

export const SESSION_EVENT_VOLUME = 'volume' as const
export const SESSION_EVENT_TRANSCRIPT = 'transcript' as const
export const SESSION_EVENT_METADATA = 'metadata' as const
export const SESSION_EVENT_COMPLETE = 'complete' as const
export const SESSION_EVENT_ERROR = 'error' as const

export const SESSION_EVENT_KEYS = {
  volume: SESSION_EVENT_VOLUME,
  transcript: SESSION_EVENT_TRANSCRIPT,
  metadata: SESSION_EVENT_METADATA,
  complete: SESSION_EVENT_COMPLETE,
  error: SESSION_EVENT_ERROR,
} as const
