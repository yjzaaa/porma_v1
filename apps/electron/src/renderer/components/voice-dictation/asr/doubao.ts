/**
 * 语音模块 — 豆包 ASR Provider
 *
 * 基于豆包流式语音识别服务的实现，通过统一外部交互层与主进程通信。
 *
 * 数据流：
 *   Session PCM 帧 → downsample → pendingAudio 累积 → 分片（200ms/chunk）
 *   → ASR 对外交互层 → 主进程
 *   → 豆包 ASR → 转写/状态事件 → 渲染进程
 *
 * 特性：
 *   - 权限检查（checkMicrophonePermission / requestMicrophonePermission）
 *   - 回取免提缓冲（获取 VAD 触发前的音频上下文）
 *   - PCM 实时分片（200ms 块）流式发送
 *   - 事件监听隔离（sessionId 守卫，防止跨会话串扰）
 *
 * @see ../utils/pcm.ts - PCM 工具函数
 * @see ../types/asr.ts - ASRProvider 接口定义
 * @see ../core/modules/VoiceCaptureModule.ts - 录音会话与 PCM 来源
 */

import type { ASRProvider, ASREventListener } from '../types/asr'
import { ASREventBus } from '../types/asr'
import type { PcmFrame } from '../types/panel'
import type { VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../../types'
import type { VoiceAsrTransportBus } from '../core/bus/VoiceAsrTransportBus'
import { CHUNK_BYTES, concatAudioBuffers, splitChunk, TARGET_SAMPLE_RATE } from '../utils/pcm'

export class DoubaoProvider implements ASRProvider {
  /** ASR 事件总线 */
  private readonly eventBus = new ASREventBus()
  /** 外部交互总线 */
  private readonly transport: VoiceAsrTransportBus
  /** 当前 ASR 会话 ID（用于 IPC 消息隔离） */
  private sessionId: string | null = null
  /** 主进程 ASR 是否就绪（startVoiceDictation 成功返回后为 true） */
  private asrReady = false
  /** 当前definite状态 */
  private currentDefinite?: boolean
  /** utterances信息 */
  private currentUtterances?: Array<{text: string, definite: boolean}>
  /** 待分片的 PCM 缓冲（累积处理未满一帧的残留数据） */
  private pendingAudio: ArrayBuffer[] = []
  /** 等待发送的备援音频队列 */
  private queuedAudio: ArrayBuffer[] = []
  /** 是否正在停止中（阻止新数据处理） */
  private stopping = false
  /** 主进程返回的累积转写文本 */
  private transcriptText = ''
  /** 停止等待 Promise 的 resolve（等待主进程 session 真正结束） */
  private stopWaitResolve: (() => void) | null = null
  /** 停止等待 Promise 的兜底超时 */
  private stopWaitTimeout: ReturnType<typeof setTimeout> | null = null
  /** IPC 监听器清理函数 */
  private cleanupListeners: (() => void) | null = null

  constructor(transport?: VoiceAsrTransportBus) {
    if (!transport) {
      throw new Error('DoubaoProvider 需要 ASR 对外交互总线')
    }
    this.transport = transport
  }

  onEvent(listener: ASREventListener): () => void {
    const unsubs = [
      this.eventBus.on('state', listener),
      this.eventBus.on('transcript', listener),
      this.eventBus.on('volume', listener),
      this.eventBus.on('end', listener),
      this.eventBus.on('error', listener),
    ]
    return () => unsubs.forEach((unsub) => unsub())
  }

  /**
   * 启动豆包 ASR 会话
   */
  async start(): Promise<void> {
    const sid = crypto.randomUUID()
    if (!(await this.prepareStartSession(sid))) return
    await this.startTransportSession(sid)
  }

  /**
   * 接收会话侧推送的 PCM 帧并转发给主进程
   */
  pushAudio(frame: PcmFrame): void {
    if (this.stopping || !this.sessionId) return
    const pcm = this.convertFrameToPcm(frame)
    if (!this.asrReady) {
      this.queuedAudio.push(pcm)
      return
    }
    this.pendingAudio.push(pcm)
    this.flushPendingAudio()
  }

  /**
   * 主动停止 ASR 并等待最终结果
   *
   * @returns 主进程返回的最终转写文本
   *
   * 清理顺序：停止音频采集 → IPC 通知主进程停止 ASR → 清空待发送缓冲
   */
  async stop(): Promise<string> {
    this.stopping = true
    this.asrReady = false
    const sid = this.sessionId

    // 通知主进程停止 ASR，并等待最终 transcript/idle 状态回流，避免尾字丢失
    if (sid) {
      const waitDone = this.waitForStopCompletion()
      await this.transport.request('stopVoiceDictation', { sessionId: sid }).catch(() => {})
      await waitDone
    }
    this.pendingAudio = []

    return this.transcriptText.trim()
  }

  /**
   * 取消 ASR（丢弃结果）
   *
   * 不清除 transcriptText（但外部调用后也不会用它）。
   */
  async cancel(): Promise<void> {
    this.stopping = true
    this.asrReady = false
    const sid = this.sessionId
    if (sid) { this.transport.request('cancelVoiceDictation', { sessionId: sid }).catch(() => {}) }
    this.resolveStopWait()
    this.pendingAudio = []
    this.queuedAudio = []
  }

  /**
   * 获取当前识别的详细信息
   */
  getCurrentRecognitionDetails(): {
    text: string
    isFinal: boolean
    confidence: number
    definite?: boolean
    utterances?: Array<{text: string, definite: boolean}>
  } {
    return {
      text: this.transcriptText,
      isFinal: false, // 豆包ASR在onend时才确定最终
      confidence: 0.8, // 置信度可以取自result.confidence
      definite: this.currentDefinite,
      utterances: this.currentUtterances
    }
  }

  /** 释放所有资源（幂等） */
  dispose(): void {
    this.cleanupListeners?.()
    this.cleanupListeners = null
    if (this.stopWaitTimeout) clearTimeout(this.stopWaitTimeout)
    this.stopWaitTimeout = null
    this.stopWaitResolve = null
    this.cancel().catch(() => {})
    this.sessionId = null
    this.asrReady = false
    this.currentDefinite = undefined
    this.currentUtterances = undefined
    this.eventBus.clear()
  }

  /**
   * 将会话 PCM 帧转换为 16k 识别分片。
   */
  private convertFrameToPcm(frame: PcmFrame): ArrayBuffer {
    if (frame.sampleRate <= TARGET_SAMPLE_RATE) {
      return frame.data.buffer.slice(frame.data.byteOffset, frame.data.byteOffset + frame.data.byteLength)
    }

    const ratio = frame.sampleRate / TARGET_SAMPLE_RATE
    const outputLength = Math.floor(frame.data.length / ratio)
    const buffer = new ArrayBuffer(outputLength * 2)
    const view = new DataView(buffer)

    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio)
      const end = Math.min(Math.floor((i + 1) * ratio), frame.data.length)
      let sum = 0
      for (let j = start; j < end; j += 1) {
        sum += frame.data[j] ?? 0
      }
      const sample = sum / Math.max(1, end - start)
      view.setInt16(i * 2, sample, true)
    }

    return buffer
  }

  /**
   * 刷新等待发送的 PCM 分片。
   */
  private flushPendingAudio(): void {
    const sid = this.sessionId
    if (!sid || this.stopping || !this.asrReady) return
    let merged = concatAudioBuffers(this.pendingAudio)
    const next: ArrayBuffer[] = []
    while (merged.byteLength >= CHUNK_BYTES) {
      const { chunk, rest } = splitChunk(merged, CHUNK_BYTES)
      if (!chunk) break
      this.sendAudioChunk(chunk)
      merged = rest
    }
    if (merged.byteLength > 0) next.push(merged)
    this.pendingAudio = next
  }

  /**
   * 发送单个 PCM 分片。
   */
  private sendAudioChunk(chunk: ArrayBuffer): void {
    const sid = this.sessionId
    if (!sid || this.stopping) return
    this.transport.request('sendVoiceDictationAudio', { sessionId: sid, data: chunk }).catch(() => {})
  }

  /**
   * 在 ASR 就绪后刷新启动前积压的音频。
   */
  private flushQueuedAudio(): void {
    if (!this.asrReady || this.stopping) return
    if (this.queuedAudio.length > 0) {
      this.pendingAudio.push(...this.queuedAudio)
      this.queuedAudio = []
      this.flushPendingAudio()
    }
  }

  /**
   * 等待主进程关闭 ASR 会话，确保最终 transcript 已回流。
   */
  private waitForStopCompletion(): Promise<void> {
    this.resolveStopWait()
    return new Promise<void>((resolve) => {
      this.stopWaitResolve = resolve
      this.stopWaitTimeout = setTimeout(() => {
        this.resolveStopWait()
      }, 1500)
    })
  }

  /**
   * 结束 stop 等待（幂等）。
   */
  private resolveStopWait(): void {
    if (this.stopWaitTimeout) {
      clearTimeout(this.stopWaitTimeout)
      this.stopWaitTimeout = null
    }
    const resolve = this.stopWaitResolve
    this.stopWaitResolve = null
    resolve?.()
  }

  /**
   * 准备会话启动前的本地状态与监听器。
   */
  private async prepareStartSession(sessionId: string): Promise<boolean> {
    this.resetSessionState(sessionId)
    if (!(await this.ensureMicrophonePermission())) {
      return false
    }
    this.cleanupListeners = this.registerTransportListeners()
    return true
  }

  /**
   * 重置本次会话的本地状态。
   */
  private resetSessionState(sessionId: string): void {
    this.cleanupListeners?.()
    this.cleanupListeners = null
    this.stopping = false
    this.asrReady = false
    this.pendingAudio = []
    this.queuedAudio = []
    this.transcriptText = ''
    this.sessionId = sessionId
    this.currentDefinite = undefined
    this.currentUtterances = undefined
  }

  /**
   * 检查并请求麦克风权限。
   */
  private async ensureMicrophonePermission(): Promise<boolean> {
    const perm = await this.transport.request('checkMicrophonePermission', undefined)
    if (perm.status === 'granted') return true
    if (perm.status === 'denied') {
      this.eventBus.emit('error', { message: '麦克风权限被阻止' })
      return false
    }

    const req = await this.transport.request('requestMicrophonePermission', undefined)
    if (req.status === 'granted') return true
    this.eventBus.emit('error', { message: '需要麦克风权限' })
    return false
  }

  /**
   * 注册主进程回传事件。
   */
  private registerTransportListeners(): () => void {
    const unsubs: Array<() => void> = []
    unsubs.push(
      this.transport.onEvent((event) => this.handleTransportEvent(event)),
    )
    return () => unsubs.forEach((unsub) => unsub())
  }

  /**
   * 处理主进程回传事件。
   */
  private handleTransportEvent(event: { type: 'transcript'; payload: VoiceDictationTranscriptEvent } | { type: 'state'; payload: VoiceDictationStateEvent }): void {
    if (event.type === 'transcript') {
      this.handleTranscriptEvent(event.payload)
      return
    }
    this.handleStateEvent(event.payload)
  }

  /**
   * 处理转写事件。
   */
  private handleTranscriptEvent(event: VoiceDictationTranscriptEvent): void {
    if (event.sessionId !== this.sessionId) return
    if (event.metadata?.utterances) {
      this.currentUtterances = event.metadata.utterances
      this.currentDefinite = event.metadata.utterances.some((utterance) => utterance.definite === true)
    }
    this.transcriptText = event.text
    this.eventBus.emit('transcript', { text: event.text, isFinal: event.isFinal })
  }

  /**
   * 处理状态事件。
   */
  private handleStateEvent(event: VoiceDictationStateEvent): void {
    if (event.sessionId && event.sessionId !== this.sessionId) return
    this.eventBus.emit('state', { state: event.status, message: event.message })
    if (this.stopping && (event.status === 'idle' || event.status === 'completed' || event.status === 'error')) {
      this.resolveStopWait()
    }
  }

  /**
   * 启动主进程 ASR，会话就绪后回放免提缓冲。
   */
  private async startTransportSession(sessionId: string): Promise<void> {
    this.eventBus.emit('state', { state: 'connecting', message: '连接 ASR...' })
    await this.transport.request('startVoiceDictation', { sessionId })
    if (this.sessionId !== sessionId) return

    this.asrReady = true
    this.flushQueuedAudio()
    await this.restoreHandsfreeBuffer(sessionId)
  }

  /**
   * 回放免提缓冲。
   */
  private async restoreHandsfreeBuffer(sessionId: string): Promise<void> {
    try {
      const buf = await this.transport.request('getHandsfreeBuffer', undefined)
      if (!buf || buf.byteLength === 0 || this.sessionId !== sessionId) return
      const chunkSize = 6400
      let offset = 0
      while (offset < buf.byteLength) {
        const end = Math.min(offset + chunkSize, buf.byteLength)
        this.sendAudioChunk(buf.slice(offset, end))
        offset = end
      }
    } catch {}
  }
}
