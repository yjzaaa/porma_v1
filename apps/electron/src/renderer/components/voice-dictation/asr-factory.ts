/**
 * ASR Provider 工厂
 */

import type { ASRProvider, ASRProviderType } from './asr-types'
import { DoubaoProvider } from './doubao-provider'
import { WebSpeechProvider } from './webspeech-provider'

export function createASRProvider(type: ASRProviderType): ASRProvider {
  return type === 'webspeech' ? new WebSpeechProvider() : new DoubaoProvider()
}
