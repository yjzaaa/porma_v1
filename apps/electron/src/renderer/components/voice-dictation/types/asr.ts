import type { PcmFrame } from './panel'

/**
 * 语音模块 — ASR Provider 类型定义
 *
 * 抽象的语音识别引擎接口，通过事件驱动暴露状态：
 * - doubao: 豆包 ASR（走 IPC + 主进程链路，支持实时流式转写）
 * - webspeech: 浏览器原生 SpeechRecognition（零 IPC、零 API Key，依赖 Chrome 引擎）
 *
 * @see createASRProvider - 工厂函数位置
 */

/** ASR 事件载荷映射 */
export interface ASREventMap {
  /** Provider 状态变更 */
  state: { state: string; message?: string }
  /** 实时转写文本 */
  transcript: { text: string; isFinal: boolean }
  /** 实时音量峰值（0-1 归一化） */
  volume: { peak: number }
  /** Provider 端主动结束 */
  end: { text: string }
  /** 错误通知 */
  error: { message: string }
}

/** ASR 事件联合 */
export type ASREvent =
  | ({ type: 'state' } & ASREventMap['state'])
  | ({ type: 'transcript' } & ASREventMap['transcript'])
  | ({ type: 'volume' } & ASREventMap['volume'])
  | ({ type: 'end' } & ASREventMap['end'])
  | ({ type: 'error' } & ASREventMap['error'])

/** ASR 事件名 */
export type ASREventType = keyof ASREventMap

/** ASR 事件监听器 */
export type ASREventListener = (event: ASREvent) => void

/** ASR 事件总线 */
export class ASREventBus {
  private readonly listeners: {
    [K in ASREventType]: Set<ASREventListener>
  } = {
    state: new Set(),
    transcript: new Set(),
    volume: new Set(),
    end: new Set(),
    error: new Set(),
  }

  /**
   * 订阅事件
   */
  on<K extends ASREventType>(event: K, listener: ASREventListener): () => void {
    const set = this.listeners[event]
    set.add(listener)
    return () => set.delete(listener)
  }

  /**
   * 发布事件
   */
  emit<K extends ASREventType>(event: K, payload: ASREventMap[K]): void {
    const set = this.listeners[event]
    for (const listener of set) {
      listener({ type: event, ...payload } as ASREvent)
    }
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.state.clear()
    this.listeners.transcript.clear()
    this.listeners.volume.clear()
    this.listeners.end.clear()
    this.listeners.error.clear()
  }
}

/** 可用的 ASR Provider 类型 */
export type ASRProviderType = 'doubao' | 'webspeech'

/** ASR Provider 接口定义 */
export interface ASRProvider {
  /** 订阅 ASR 事件 */
  onEvent(listener: ASREventListener): () => void
  /** 启动识别会话，建立连接并准备接收 PCM */
  start(): Promise<void>
  /** 接收会话侧推送的 PCM 帧 */
  pushAudio(frame: PcmFrame): void
  /** 主动停止识别，返回最终累积的转写文本 */
  stop(): Promise<string>
  /** 取消识别，丢弃本次结果 */
  cancel(): Promise<void>
  /** 释放所有资源：断开监听、清空状态 */
  dispose(): void
}
