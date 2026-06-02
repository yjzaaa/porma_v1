/**
 * 语音事件总线
 *
 * 统一语音模块内部的事件驱动通信，避免 UI 组件直接耦合 window 事件。
 */

/** 自动发送请求事件名 */
export const VOICE_AUTO_SEND_REQUESTED_EVENT = 'proma:voice-auto-send-requested'
/** 语音设置变更事件名 */
export const VOICE_SETTINGS_CHANGED_EVENT = 'proma:voice-settings-changed'

/** 自动发送请求载荷 */
export interface VoiceAutoSendRequestedDetail {
  /** 待发送文本 */
  text: string
}

type VoiceSettingsChangedListener = () => void
type VoiceAutoSendListener = (detail: VoiceAutoSendRequestedDetail) => void

/** 模块级单例监听集合 */
const autoSendListeners = new Set<VoiceAutoSendListener>()
const settingsChangedListeners = new Set<VoiceSettingsChangedListener>()

/**
 * 发布自动发送请求
 */
export function emitVoiceAutoSendRequested(detail: VoiceAutoSendRequestedDetail): void {
  for (const listener of autoSendListeners) {
    listener(detail)
  }
}

/**
 * 订阅自动发送请求
 */
export function onVoiceAutoSendRequested(
  listener: (detail: VoiceAutoSendRequestedDetail) => void,
): () => void {
  autoSendListeners.add(listener)
  return () => autoSendListeners.delete(listener)
}

/**
 * 发布语音设置变更事件
 */
export function emitVoiceSettingsChanged(): void {
  for (const listener of settingsChangedListeners) {
    listener()
  }
}

/**
 * 订阅语音设置变更事件
 */
export function onVoiceSettingsChanged(listener: () => void): () => void {
  settingsChangedListeners.add(listener)
  return () => settingsChangedListeners.delete(listener)
}
