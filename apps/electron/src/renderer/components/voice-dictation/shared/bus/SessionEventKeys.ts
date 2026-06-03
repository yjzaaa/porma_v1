/**
 * Session 事件 key 常量
 *
 * 单次录音会话内部使用的事件 key。把说明写在这里，其他模块直接 hover
 * 常量即可看到每个事件的用途。
 */

/**
 * 当前会话的实时音量峰值。
 */
export const SESSION_EVENT_VOLUME = 'volume' as const
/**
 * 当前会话的实时转写结果。
 */
export const SESSION_EVENT_TRANSCRIPT = 'transcript' as const
/**
 * 当前会话的元数据状态消息。
 */
export const SESSION_EVENT_METADATA = 'metadata' as const
/**
 * 当前会话的完成结果。
 */
export const SESSION_EVENT_COMPLETE = 'complete' as const
/**
 * 当前会话的错误信息。
 */
export const SESSION_EVENT_ERROR = 'error' as const

/**
 * Session 事件键分组对象。
 *
 * 主要用于总线初始化和统一引用。
 */
export const SESSION_EVENT_KEYS = {
  volume: SESSION_EVENT_VOLUME,
  transcript: SESSION_EVENT_TRANSCRIPT,
  metadata: SESSION_EVENT_METADATA,
  complete: SESSION_EVENT_COMPLETE,
  error: SESSION_EVENT_ERROR,
} as const
