/**
 * 豆包 ASR 音频缓冲层
 *
 * 只负责 PCM 帧的积压、分片和发送，不关心主进程桥接细节。
 */

import type { PcmFrame } from '../../../shared/types/panel'
import type { DoubaoSessionContext } from './context'
import { CHUNK_BYTES, concatAudioBuffers, pcmFrameTo16BitBuffer, splitChunk } from '../../../shared/utils/pcm'

export interface DoubaoAudioPipelineOptions extends DoubaoSessionContext {
  /** 当前 ASR 是否已就绪 */
  isAsrReady: () => boolean
  /** 发送单个音频分片 */
  sendAudioChunk: (chunk: ArrayBuffer) => void
}

/**
 * 豆包 ASR 音频缓冲器
 *
 * 把“采集帧 → 降采样 → 缓冲 → 200ms 分片发送”这段逻辑独立出来，
 * 让 Provider 本身不再背负音频队列细节。
 */
export class DoubaoAudioPipeline {
  private readonly pendingAudio: ArrayBuffer[] = []
  private readonly queuedAudio: ArrayBuffer[] = []

  constructor(private readonly options: DoubaoAudioPipelineOptions) {}

  /**
   * 接收一帧音频并决定是暂存还是直接发送。
   */
  pushAudio(frame: PcmFrame): void {
    const sessionId = this.options.getSessionId()
    if (this.options.isStopping() || !sessionId) return

    const pcm = pcmFrameTo16BitBuffer(frame)
    if (!this.options.isAsrReady()) {
      this.queuedAudio.push(pcm)
      return
    }

    this.pendingAudio.push(pcm)
    this.flushPendingAudio()
  }

  /**
   * 在 ASR 就绪后，把启动前积压的音频重新送入待发送队列。
   */
  flushQueuedAudio(): void {
    if (!this.options.isAsrReady() || this.options.isStopping()) return
    if (this.queuedAudio.length === 0) return

    this.pendingAudio.push(...this.queuedAudio)
    this.queuedAudio.length = 0
    this.flushPendingAudio()
  }

  /**
   * 清空当前缓冲。
   */
  clear(): void {
    this.pendingAudio.length = 0
    this.queuedAudio.length = 0
  }

  /**
   * 将待发送音频合并并按固定大小切块发送。
   */
  private flushPendingAudio(): void {
    const sessionId = this.options.getSessionId()
    if (!sessionId || this.options.isStopping() || !this.options.isAsrReady()) return

    let merged = concatAudioBuffers(this.pendingAudio)
    const next: ArrayBuffer[] = []

    while (merged.byteLength >= CHUNK_BYTES) {
      const { chunk, rest } = splitChunk(merged, CHUNK_BYTES)
      if (!chunk) break
      this.options.sendAudioChunk(chunk)
      merged = rest
    }

    if (merged.byteLength > 0) {
      next.push(merged)
    }

    this.pendingAudio.length = 0
    this.pendingAudio.push(...next)
  }
}
