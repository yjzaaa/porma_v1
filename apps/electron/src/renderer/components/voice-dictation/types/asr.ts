/**
 * 语音模块 — ASR Provider 类型
 *
 * 抽象的语音识别引擎接口，可切换实现：
 * - doubao: 豆包 ASR（走 IPC + 主进程）
 * - webspeech: 浏览器原生 SpeechRecognition
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
