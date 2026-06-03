/**
 * 【第 7 层 - ASR Provider 层】ASR Provider 工厂
 *
 * 根据配置的类型字符串创建对应的 ASR Provider 实例。
 * 默认（包括 'doubao' 和未知类型）走 DoubaoProvider（统一外部交互链路），
 * 'webspeech' 走浏览器内置 SpeechRecognition。
 *
 * @see ASRProviderType - 支持的 Provider 类型字面量
 * @see DoubaoProvider - 豆包 ASR 实现
 * @see WebSpeechProvider - 浏览器 Web Speech API 实现
 */

import type { ASRProvider, ASRProviderType } from '../shared/types/asr'
import type { VoiceAsrTransportBus } from '../shared/bus/VoiceAsrTransportBus'
import { DoubaoProvider } from './providers/doubao/index.ts'
import { WebSpeechProvider } from './providers/webspeech/index.ts'

/**
 * 创建 ASR Provider 实例
 *
 * @param type - Provider 类型
 * @returns 实现了 ASRProvider 接口的实例
 *
 * 扩展方式：新增 Provider 类型时只需在此添加 case 分支。
 */
export function createASRProvider(type: ASRProviderType, transport?: VoiceAsrTransportBus): ASRProvider {
  return type === 'webspeech' ? new WebSpeechProvider() : new DoubaoProvider(transport)
}
