/**
 * 语音模块 — 自动发送判断策略
 */

import { createVoiceTextSnapshot } from './voice-text'
import type { AutoSendMode } from '../types/intelligence'

const MIN_AUTO_SEND_LENGTH = 4

export function shouldAutoSend(
  text: string,
  enabled: boolean = true,
  mode: AutoSendMode = 'always',
): boolean {
  const snapshot = createVoiceTextSnapshot(text)
  if (snapshot.isBlank) return false
  if (!enabled) return false

  if (mode === 'always') {
    return snapshot.length >= MIN_AUTO_SEND_LENGTH
  }

  if (mode === 'smart') {
    if (snapshot.length < MIN_AUTO_SEND_LENGTH) return false
    if (snapshot.hasSentenceEndingPunctuation || snapshot.hasPauseEndingPunctuation) return true
    if (snapshot.endsWithIncompleteEnding) return false
    if (snapshot.length > 20) return true
    return false
  }

  if (mode === 'ai') {
    return snapshot.length >= MIN_AUTO_SEND_LENGTH
  }

  return false
}
