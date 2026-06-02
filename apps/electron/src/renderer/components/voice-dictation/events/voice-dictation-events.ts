/**
 * 语音事件总线
 *
 * 统一语音模块内部的事件驱动通信，避免 UI 组件直接耦合发送实现。
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

/**
 * 发布自动发送请求
 */
export function emitVoiceAutoSendRequested(detail: VoiceAutoSendRequestedDetail): void {
  window.dispatchEvent(new CustomEvent<VoiceAutoSendRequestedDetail>(VOICE_AUTO_SEND_REQUESTED_EVENT, {
    detail,
  }))
}

/**
 * 订阅自动发送请求
 */
export function onVoiceAutoSendRequested(
  listener: (detail: VoiceAutoSendRequestedDetail) => void,
): () => void {
  const handler = (event: Event): void => {
    const customEvent = event as CustomEvent<VoiceAutoSendRequestedDetail>
    if (!customEvent.detail?.text) return
    listener(customEvent.detail)
  }
  window.addEventListener(VOICE_AUTO_SEND_REQUESTED_EVENT, handler as EventListener)
  return () => window.removeEventListener(VOICE_AUTO_SEND_REQUESTED_EVENT, handler as EventListener)
}

/**
 * 发布语音设置变更事件
 */
export function emitVoiceSettingsChanged(): void {
  window.dispatchEvent(new CustomEvent(VOICE_SETTINGS_CHANGED_EVENT))
}

/**
 * 订阅语音设置变更事件
 */
export function onVoiceSettingsChanged(listener: () => void): () => void {
  const handler = (): void => listener()
  window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, handler as EventListener)
  return () => window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, handler as EventListener)
}
