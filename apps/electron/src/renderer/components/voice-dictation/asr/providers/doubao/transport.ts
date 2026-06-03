/**
 * 豆包 ASR 主进程桥接层
 *
 * 负责和 VoiceAsrTransportBus 对接，处理 start / stop / transcript / state
 * 这条链路，不承担音频缓冲职责。
 */

import type { TypedEventBus } from '../../../shared/bus/TypedEventBus'
import type { ASREventMap } from '../../../shared/types/asr'
import type { VoiceAsrTransportBus, VoiceAsrTransportEvent } from '../../../shared/bus/VoiceAsrTransportBus'
import type { VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../../../../types'
import type { DoubaoSessionContext } from './context'

export interface DoubaoTransportBridgeOptions extends DoubaoSessionContext {
  /** ASR 事件总线 */
  eventBus: TypedEventBus<ASREventMap>
  /** 外部交互总线 */
  transport: VoiceAsrTransportBus
  /** 设置 ASR 就绪状态 */
  setAsrReady: (ready: boolean) => void
  /** 允许音频层在启动完成后刷新积压音频 */
  flushQueuedAudio: () => void
  /** 回收 stop 等待器 */
  resolveStopWait: () => void
  /** 更新当前 definite 状态 */
  setCurrentDefinite: (value?: boolean) => void
  /** 更新当前 utterances 状态 */
  setCurrentUtterances: (value?: Array<{ text: string; definite: boolean }>) => void
  /** 更新当前累计文本 */
  setTranscriptText: (value: string) => void
  /** 发送单个音频分片 */
  sendAudioChunk: (chunk: ArrayBuffer) => void
}

/**
 * 豆包 ASR 运输桥接
 */
export class DoubaoTransportBridge {
  constructor(private readonly options: DoubaoTransportBridgeOptions) {}

  /**
   * 订阅主进程回传事件。
   */
  registerListeners(): () => void {
    return this.options.transport.onEvent((event) => this.handleTransportEvent(event))
  }

  /**
   * 启动主进程 ASR，会话就绪后回放免提缓冲。
   */
  async startTransportSession(sessionId: string): Promise<void> {
    this.options.eventBus.emit('state', { state: 'connecting', message: '连接 ASR...' })
    await this.options.transport.request('startVoiceDictation', { sessionId })
    if (this.options.getSessionId() !== sessionId) return

    this.options.setAsrReady(true)
    this.options.flushQueuedAudio()
    await this.restoreHandsfreeBuffer(sessionId)
  }

  /**
   * 处理主进程回传事件。
   */
  private handleTransportEvent(event: VoiceAsrTransportEvent): void {
    const sessionId = this.options.getSessionId()
    if (!sessionId) return

    if (event.type === 'transcript') {
      this.handleTranscriptEvent(sessionId, event.payload)
      return
    }

    this.handleStateEvent(sessionId, event.payload)
  }

  /**
   * 处理转写事件。
   */
  private handleTranscriptEvent(sessionId: string, event: VoiceDictationTranscriptEvent): void {
    if (event.sessionId !== sessionId) return

    if (event.metadata?.utterances) {
      this.options.setCurrentUtterances(event.metadata.utterances)
      this.options.setCurrentDefinite(event.metadata.utterances.some((utterance) => utterance.definite === true))
    }

    this.options.setTranscriptText(event.text)
    this.options.eventBus.emit('transcript', { text: event.text, isFinal: event.isFinal })
  }

  /**
   * 处理状态事件。
   */
  private handleStateEvent(sessionId: string, event: VoiceDictationStateEvent): void {
    if (event.sessionId && event.sessionId !== sessionId) return

    this.options.eventBus.emit('state', { state: event.status, message: event.message })

    if (event.status === 'idle' || event.status === 'completed' || event.status === 'error') {
      this.options.setAsrReady(false)
      if (this.options.isStopping()) {
        this.options.resolveStopWait()
      } else if (event.status === 'idle' && event.message === 'asr_session_ended') {
        this.options.eventBus.emit('error', { message: 'ASR 会话因长时间无活动已断开' })
      }
    }
  }

  /**
   * 回放免提缓冲。
   */
  private async restoreHandsfreeBuffer(sessionId: string): Promise<void> {
    try {
      const buffer = await this.options.transport.request('getHandsfreeBuffer', undefined)
      if (!buffer || buffer.byteLength === 0 || this.options.getSessionId() !== sessionId) return

      const chunkSize = 6400
      let offset = 0
      while (offset < buffer.byteLength) {
        const end = Math.min(offset + chunkSize, buffer.byteLength)
        this.options.sendAudioChunk(buffer.slice(offset, end))
        offset = end
      }
    } catch {}
  }
}
