/**
 * 语音输入设置服务
 *
 * 独立处理豆包 ASR 凭证，避免通过通用 settings IPC 暴露加密细节。
 */

import { safeStorage } from 'electron'
import type { VoiceDictationSettings, VoiceDictationSettingsUpdate } from '../../../types'
import { getSettings, updateSettings } from '../storage/settings-service'

const DEFAULT_VOICE_DICTATION_SETTINGS: VoiceDictationSettings = {
  enabled: false,
  provider: 'doubao',
  appId: '',
  accessToken: '',
  resourceId: 'volc.seedasr.sauc.duration',
  language: '',
  endpointMode: 'async',
  outputMode: 'auto',
  customHotwords: '',
  vadStopTimeoutMs: 1800,
  vadMinRecordMs: 500,
  autoSendEnabled: true,
  handsfreeEnabled: false,
  engine: 'doubao',
}

function encryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[语音输入] safeStorage 加密不可用，将以明文存储 Access Token')
    return value
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch (error) {
    console.error('[语音输入] 解密 Access Token 失败:', error)
    return ''
  }
}

/** 获取解密后的语音输入设置 */
export function getVoiceDictationSettings(): VoiceDictationSettings {
  const raw = getSettings().voiceDictation ?? {}
  const encryptedAccessToken = raw.accessToken ?? raw.accessKey ?? ''
  return {
    ...DEFAULT_VOICE_DICTATION_SETTINGS,
    ...raw,
    appId: (raw.appId ?? raw.appKey ?? '').trim(),
    accessToken: decryptSecret(encryptedAccessToken).trim(),
    resourceId: (raw.resourceId ?? '').trim(),
    customHotwords: typeof raw.customHotwords === 'string' ? raw.customHotwords : '',
  }
}

/** 保存语音输入设置，Access Token 加密后落盘 */
export function updateVoiceDictationSettings(
  updates: VoiceDictationSettingsUpdate,
): VoiceDictationSettings {
  const current = getVoiceDictationSettings()
  const next: VoiceDictationSettings = {
    ...current,
    ...updates,
    appId: (updates.appId ?? current.appId ?? '').trim(),
    accessToken: (updates.accessToken ?? current.accessToken ?? '').trim(),
    resourceId: (updates.resourceId ?? current.resourceId ?? '').trim(),
    provider: 'doubao',
    engine: updates.engine ?? current.engine ?? 'webspeech',
  }

  updateSettings({
    voiceDictation: {
      ...next,
      accessToken: encryptSecret(next.accessToken),
    },
  })

  return next
}
