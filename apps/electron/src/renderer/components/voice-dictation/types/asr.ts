/**
 * 语音模块 — ASR Provider 类型定义
 *
 * 抽象的语音识别引擎接口，通过工厂模式切换实现：
 * - doubao: 豆包 ASR（走 IPC + 主进程链路，支持实时流式转写）
 * - webspeech: 浏览器原生 SpeechRecognition（零 IPC、零 API Key，依赖 Chrome 引擎）
 *
 * @see createASRProvider - 工厂函数位置
 */

/** ASR Provider 状态回调集合 */
export interface ASRCallbacks {
  /** 实时转写文本回调（isFinal 表示该段已稳定不再变更） */
  onTranscript: (text: string, isFinal: boolean) => void
  /** Provider 内部状态变更通知（如 "connecting"、"recognizing"） */
  onState: (state: string, message?: string) => void
  /** 实时音量峰值回调（0-1 归一化） */
  onVolume?: (peak: number) => void
  /** Provider 端主动结束（如 WebSpeech 的 onend 事件） */
  onEnd?: (text: string) => void
  /** 错误通知 */
  onError?: (message: string) => void
}

/** ASR Provider 接口定义 */
export interface ASRProvider {
  /** 启动识别会话，建立连接并开始音频采集 */
  start(callbacks: ASRCallbacks): Promise<void>
  /** 主动停止识别，返回最终累积的转写文本 */
  stop(): Promise<string>
  /** 取消识别，丢弃本次结果（不出发 complete 流程） */
  cancel(): Promise<void>
  /** 释放所有资源：断开 IPC 监听、关闭音频流 */
  dispose(): void
}

/** 可用的 ASR Provider 类型 */
export type ASRProviderType = 'doubao' | 'webspeech'
