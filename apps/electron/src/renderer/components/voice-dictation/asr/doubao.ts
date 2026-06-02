/**
 * 语音模块 — 豆包 ASR Provider
 *
 * 基于豆包流式语音识别服务的实现，通过 IPC 与主进程通信。
 *
 * 数据流：
 *   getUserMedia → AudioContext → ScriptProcessor (4096 缓冲) → floatTo16BitPcm
 *   → pendingAudio 累积 → 分片（200ms/chunk） → IPC sendVoiceDictationAudio → 主进程
 *   → 豆包 ASR → IPC onVoiceDictationTranscript → 渲染进程
 *
 * 特性：
 *   - 权限检查（checkMicrophonePermission / requestMicrophonePermission）
 *   - 回取免提缓冲（获取 VAD 触发前的音频上下文）
 *   - PCM 实时分片（200ms 块）流式发送
 *   - IPC 事件监听隔离（sessionId 守卫，防止跨会话串扰）
 *
 * @see ../utils/pcm.ts - PCM 工具函数
 * @see ../types/asr.ts - ASRProvider 接口定义
 * @see ../core/runtime/AudioHub.ts - 环形缓冲（用于免提回取）
 */

import type { ASRProvider, ASREventListener } from '../types/asr'
import { ASREventBus } from '../types/asr'
import type { VoiceDictationSettings, VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../../types'
import { CHUNK_BYTES, concatAudioBuffers, floatTo16BitPcm, splitChunk } from '../utils/pcm'
import {
  createVoiceEventLogger,
  VoiceLogEventEmitter,
  VoiceLogEventSubscriber,
  type VoiceLogEventListener,
} from '../ui-events'

/** AudioContext 引用（兼容 WebKit 前缀） */
const ACTX = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined

export class DoubaoProvider implements ASRProvider {
  /** ASR 事件总线 */
  private readonly eventBus = new ASREventBus()
  /** 日志事件发射器 */
  private readonly eventEmitter = new VoiceLogEventEmitter()
  /** 统一日志适配器（事件驱动） */
  private readonly logger = createVoiceEventLogger(this.eventEmitter)
  /** 日志订阅器 */
  private readonly eventLogger = new VoiceLogEventSubscriber('豆包ASR', this.eventEmitter)
  /** 当前 ASR 会话 ID（用于 IPC 消息隔离） */
  private sessionId: string | null = null
  /** 主进程 ASR 是否就绪（startVoiceDictation 成功返回后为 true） */
  private asrReady = false
  /** 当前definite状态 */
  private currentDefinite?: boolean
  /** utterances信息 */
  private currentUtterances?: Array<{text: string, definite: boolean}>
  /** 麦克风 MediaStream */
  private stream: MediaStream | null = null
  /** 音频上下文 */
  private audioContext: AudioContext | null = null
  /** ScriptProcessor 音频处理节点（4096 帧缓冲） */
  private processor: ScriptProcessorNode | null = null
  /** 待分片的 PCM 缓冲（累积处理未满一帧的残留数据） */
  private pendingAudio: ArrayBuffer[] = []
  /** 等待发送的备援音频队列 */
  private queuedAudio: ArrayBuffer[] = []
  /** 是否正在停止中（阻止新数据处理） */
  private stopping = false
  /** stop() 的 resolve 函数（预留） */
  private resolveStop: ((text: string) => void) | null = null
  /** 主进程返回的累积转写文本 */
  private transcriptText = ''
  /** 停止超时句柄 */
  private stopTimeout: ReturnType<typeof setTimeout> | null = null
  /** 停止等待 Promise 的 resolve（等待主进程 session 真正结束） */
  private stopWaitResolve: (() => void) | null = null
  /** 停止等待 Promise 的兜底超时 */
  private stopWaitTimeout: ReturnType<typeof setTimeout> | null = null
  /** IPC 监听器清理函数 */
  private cleanupListeners: (() => void) | null = null

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
   *
   * 流程：
   *   1. 检查/请求麦克风权限
   *   2. 注册 IPC 转写事件监听器（onVoiceDictationTranscript / onVoiceDictationState）
   *   3. 发送 startVoiceDictation IPC 到主进程初始化 ASR
   *   4. 回取 AudioHub 的免提缓冲（如允许）
   *   5. 启动麦克风采集并实时分片发送音频数据
   *
   * IPC 事件通过 sessionId 守卫：只有匹配当前会话的事件才被处理，
   * 防止快速连续录音时消息交叉。
   */
  async start(): Promise<void> {
    this.stopping = false
    this.asrReady = false
    this.pendingAudio = []
    this.queuedAudio = []
    this.transcriptText = ''

    // 步骤 1: 检查麦克风权限
    const perm = await window.electronAPI.checkMicrophonePermission()
    if (perm.status === 'denied') {
      this.eventBus.emit('error', { message: '麦克风权限被阻止' })
      return
    }
    if (perm.status === 'not-determined') {
      const req = await window.electronAPI.requestMicrophonePermission()
      if (req.status !== 'granted') {
        this.eventBus.emit('error', { message: '需要麦克风权限' })
        return
      }
    }

    const sid = crypto.randomUUID()
    this.sessionId = sid

    // 步骤 2: 注册 IPC 监听器（使用 sessionId 守卫）
    const unsubs: Array<() => void> = []

    const ct = window.electronAPI.onVoiceDictationTranscript((e: VoiceDictationTranscriptEvent) => {
      if (e.sessionId !== this.sessionId) return
      
      // 提取utterances信息
      if (e.metadata?.utterances) {
        this.currentUtterances = e.metadata.utterances
        this.currentDefinite = e.metadata.utterances.some((utterance) => utterance.definite === true)
        this.logger.debug('豆包ASR utterances更新', {
          utterances: e.metadata.utterances,
          definite: this.currentDefinite 
        })
      }
      
      this.transcriptText = e.text
      this.eventBus.emit('transcript', { text: e.text, isFinal: e.isFinal })
    })
    unsubs.push(ct)

    const cs = window.electronAPI.onVoiceDictationState((e: VoiceDictationStateEvent) => {
      if (e.sessionId && e.sessionId !== this.sessionId) return
      this.eventBus.emit('state', { state: e.status, message: e.message })
      if (this.stopping && (e.status === 'idle' || e.status === 'completed' || e.status === 'error')) {
        this.resolveStopWait()
      }
    })
    unsubs.push(cs)

    this.cleanupListeners = () => unsubs.forEach(f => f())

    // 步骤 3: 通知主进程启动 ASR
    this.eventBus.emit('state', { state: 'connecting', message: '连接 ASR...' })
    await window.electronAPI.startVoiceDictation({ sessionId: sid })
    if (this.sessionId !== sid) return // 已被 cancel/stop 拦截
    this.asrReady = true

    // 步骤 4: 回取免提缓冲（AudioHub 环形缓冲中的预录音频）
    try {
      const buf = await window.electronAPI.getHandsfreeBuffer()
      if (buf && buf.byteLength > 0 && this.sessionId === sid) {
        const CH = 6400; let off = 0
        while (off < buf.byteLength) {
          const end = Math.min(off + CH, buf.byteLength)
          window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: buf.slice(off, end) }).catch(() => {}); off = end
        }
      }
    } catch {}

    // 步骤 5: 启动本地麦克风采集
    await this.startCapture()
  }

  /**
   * 启动麦克风 PCM 采集并实时发送
   *
   * 使用单独的 AudioContext（与 AudioHub 独立，避免互相干扰）。
   * 每 4096 帧触发一次 audioprocess → floatTo16BitPcm 转换
   * → 累积到 pendingAudio → 满 CHUNK_BYTES（200ms）时通过 IPC 发送。
   *
   * 多轮录音保护：sid !== this.sessionId 时停止数据处理。
   */
  private async startCapture(): Promise<void> {
    if (!ACTX || !navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } },
      })
      if (this.stopping || !this.sessionId) { stream.getTracks().forEach(t => t.stop()); return }
      this.stream = stream
      const ac = new ACTX()
      this.audioContext = ac
      const src = ac.createMediaStreamSource(stream)
      const proc = ac.createScriptProcessor(4096, 1, 1)
      this.processor = proc
      const sid = this.sessionId

      proc.onaudioprocess = (ev: any) => {
        // 多轮录音保护：sessionId 变更则停止处理旧数据
        if (this.stopping || !this.sessionId || sid !== this.sessionId) return
        if (!this.asrReady) return
        const inp = ev.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < inp.length; i++) peak = Math.max(peak, Math.abs(inp[i] ?? 0))
        this.eventBus.emit('volume', { peak: Math.min(1, peak * 4) })

        const pcm = floatTo16BitPcm(inp, ac.sampleRate)
        this.pendingAudio.push(pcm)
        let merged = concatAudioBuffers(this.pendingAudio)
        const next: ArrayBuffer[] = []
        while (merged.byteLength >= CHUNK_BYTES) {
          const { chunk, rest } = splitChunk(merged, CHUNK_BYTES)
          if (!chunk) break
          // 通过 IPC 发送固定大小的 PCM 分片
          window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: chunk }).catch(() => {}); merged = rest
        }
        if (merged.byteLength > 0) next.push(merged)
        this.pendingAudio = next
      }

      src.connect(proc); proc.connect(ac.destination)
      if (ac.state === 'suspended') await ac.resume()
    } catch {
      this.eventBus.emit('error', { message: '麦克风启动失败' })
    }
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

    // 停止本地音频采集
    this.processor?.disconnect(); this.processor = null
    this.audioContext?.close().catch(() => {}); this.audioContext = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null

    // IPC 通知主进程停止 ASR，并等待最终 transcript/idle 状态回流，避免尾字丢失
    if (sid) {
      const waitDone = this.waitForStopCompletion()
      await window.electronAPI.stopVoiceDictation({ sessionId: sid }).catch(() => {})
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
    if (sid) { window.electronAPI.cancelVoiceDictation({ sessionId: sid }).catch(() => {}) }
    this.resolveStopWait()
    this.processor?.disconnect(); this.processor = null
    this.audioContext?.close().catch(() => {}); this.audioContext = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null
    this.pendingAudio = []
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
    if (this.stopTimeout) clearTimeout(this.stopTimeout)
    if (this.stopWaitTimeout) clearTimeout(this.stopWaitTimeout)
    this.stopWaitTimeout = null
    this.stopWaitResolve = null
    this.cancel().catch(() => {})
    this.sessionId = null
    this.asrReady = false
    this.currentDefinite = undefined
    this.currentUtterances = undefined
    this.eventBus.clear()
    this.eventLogger.dispose()
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
}
