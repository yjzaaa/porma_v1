/**
 * ASR Provider 接口
 *
 * 抽象的语音识别引擎，可切换实现：
 * - doubao: 豆包 ASR（当前实现，走 IPC + 主进程）
 * - webspeech: 浏览器原生 SpeechRecognition（零额外成本）
 *
 * VoiceFloatingPanel 通过 createASRProvider 工厂获取实例，
 * 不直接依赖具体实现。
 */

/** ASR Provider 状态回调 */
export interface ASRCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void
  onState: (state: string, message?: string) => void
  onVolume?: (peak: number) => void
  onEnd?: (text: string) => void
  onError?: (message: string) => void
}

/** ASR Provider 接口 */
export interface ASRProvider {
  /** 启动识别会话 */
  start(callbacks: ASRCallbacks): Promise<void>
  /** 主动停止识别并返回最终文本 */
  stop(): Promise<string>
  /** 取消识别（丢弃结果） */
  cancel(): Promise<void>
  /** 释放资源 */
  dispose(): void
}

export type ASRProviderType = 'doubao' | 'webspeech'
