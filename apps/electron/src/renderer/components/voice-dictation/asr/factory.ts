/**
 * 语音模块 — ASR Provider 工厂
 */

import type { ASRProvider, ASRProviderType } from '../types/asr'
import { DoubaoProvider } from './doubao'
import { WebSpeechProvider } from './webspeech'

export function createASRProvider(type: ASRProviderType): ASRProvider {
  return type === 'webspeech' ? new WebSpeechProvider() : new DoubaoProvider()
}
