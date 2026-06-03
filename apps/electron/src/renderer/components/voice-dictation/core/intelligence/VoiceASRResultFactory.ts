/**
 * 语音 ASR 结果工厂
 *
 * 负责把 Provider 差异归一化成统一的 ASR 结果对象。
 */

import type { ASRProvider, ASRProviderType } from '../../shared/types/asr'
import type { UnifiedASRResult } from '../../shared/types/intelligence'

interface RecognitionDetailsAccessor {
  getCurrentRecognitionDetails?: () => {
    definite?: boolean
    utterances?: Array<{ text: string; definite: boolean }>
  }
}

interface ResultAccessor {
  getCurrentResult?: () => {
    interimText?: string
    resultIndex?: number
  }
}

/**
 * ASR 结果工厂
 */
export class VoiceASRResultFactory {
  /**
   * 创建统一 ASR 结果
   */
  create(
    text: string,
    isFinal: boolean | undefined,
    engine: ASRProviderType,
    provider?: ASRProvider,
  ): UnifiedASRResult {
    const metadata = provider ? this.extractMetadata(provider) : {}
    const draft: UnifiedASRResult = {
      text,
      isFinal: isFinal || false,
      confidence: 0.8,
      isComplete: false,
      asrType: engine,
      metadata,
    }

    return draft
  }

  /**
   * 提取 Provider 元数据
   */
  private extractMetadata(provider: ASRProvider): UnifiedASRResult['metadata'] {
    const metadata: UnifiedASRResult['metadata'] = {}
    const typedProvider = provider as RecognitionDetailsAccessor & ResultAccessor

    if (typedProvider.getCurrentRecognitionDetails) {
      try {
        const details = typedProvider.getCurrentRecognitionDetails()
        metadata.definite = details.definite
        metadata.utterances = details.utterances || []
      } catch {
        // 识别详情不可用时保持空元数据
      }
    }

    if (typedProvider.getCurrentResult) {
      try {
        const result = typedProvider.getCurrentResult()
        metadata.interimText = result.interimText
        metadata.resultIndex = result.resultIndex
      } catch {
        // WebSpeech 结果不可用时保持空元数据
      }
    }

    return metadata
  }
}
