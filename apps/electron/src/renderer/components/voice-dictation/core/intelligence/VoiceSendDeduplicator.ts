/**
 * 语音发送去重器
 *
 * 负责判定同一文本在短时间内是否已经发送过。
 */

/**
 * 去重状态快照
 */
export interface VoiceSendDeduplicatorState {
  /** 最近一次发送的文本 */
  lastSentText: string
  /** 最近一次发送时间 */
  lastSentAt: number
}

/**
 * 语音发送去重器
 */
export class VoiceSendDeduplicator {
  private lastSentText = ''
  private lastSentAt = 0

  constructor(private readonly ttlMs: number = 4000) {}

  /**
   * 判定当前文本是否需要跳过发送
   */
  shouldSkip(text: string, now: number = Date.now()): boolean {
    return text === this.lastSentText && now - this.lastSentAt < this.ttlMs
  }

  /**
   * 记录已发送文本
   */
  record(text: string, now: number = Date.now()): void {
    this.lastSentText = text
    this.lastSentAt = now
  }

  /**
   * 获取当前去重状态
   */
  snapshot(): VoiceSendDeduplicatorState {
    return {
      lastSentText: this.lastSentText,
      lastSentAt: this.lastSentAt,
    }
  }
}
