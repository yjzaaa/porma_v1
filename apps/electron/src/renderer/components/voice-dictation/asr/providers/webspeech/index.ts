/**
 * 【第 7 层 - ASR Provider 层】Web Speech API ASR Provider
 *
 * 基于浏览器内置的 SpeechRecognition（webkitSpeechRecognition）的语音识别实现。
 *
 * 特性：
 *   - 零 IPC、零 API Key，完全在渲染进程中完成
 *   - 依赖 Chrome 的 webkitSpeechRecognition 引擎（Electron 内置）
 *   - 支持 continuous 连续识别和 interimResults 中间结果
 *   - 语言默认 zh-CN
 *
 * 注意事项：
 *   - 浏览器会在识别结束时自动触发 onend，需通过 userStopped 区分用户主动停止和异常断连
 *   - no-speech 和 aborted 错误不触发 onError（属于正常情况）
 *   - stop() 后需要 150ms 等待确保 final 结果已传递
 *
 * @see ../types/asr.ts - ASRProvider 接口定义
 */

import type { ASRProvider, ASREventListener } from '../../../shared/types/asr'
import { createASREventBus, subscribeASREvents } from '../../../shared/types/asr'
import type { PcmFrame } from '../../../shared/types/panel'
import { shouldPromoteWebSpeechInterimToFinal } from '../../shared/completion'

/** Web Speech API 类型 shim（TS 内置类型中未完整包含） */
interface SpeechRecognition_ {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((ev: any) => void) | null
  onerror: ((ev: any) => void) | null
  onend: (() => void) | null
}

/** SpeechRecognition 构造函数（兼容 WebKit 前缀） */
const SpeechCtor = ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) as
  (new () => SpeechRecognition_) | undefined

export class WebSpeechProvider implements ASRProvider {
  /** ASR 事件总线 */
  private readonly eventBus = createASREventBus()
  /** 当前 Recognition 实例 */
  private recognition: SpeechRecognition_ | null = null
  /** 累积的最终识别文本 */
  private finalText = ''
  /** 是否已释放 */
  private disposed = false
  /** 是否为用户主动停止（用于 onend 时区分正常结束和用户打断） */
  private userStopped = false

  onEvent(listener: ASREventListener): () => void {
    return subscribeASREvents(this.eventBus, listener)
  }

  /**
   * 启动 Web Speech 语音识别
   *
   * 浏览器不支持时直接通过 error 事件通知，不抛异常。
   */
  async start(): Promise<void> {
    if (!SpeechCtor) {
      this.eventBus.emit('error', { message: '浏览器不支持 SpeechRecognition' })
      return
    }
    this.finalText = ''; this.disposed = false
    this.startSession()
  }

  /** Web Speech 不需要外部 PCM 输入 */
  pushAudio(_frame: PcmFrame): void {}

  /**
   * 启动一次 SpeechRecognition 会话
   *
   * 配置：continuous + interimResults + zh-CN
   * onresult：区分 final（已稳定）和 interim（临时）结果
   * onend：非用户主动停止时触发 end 事件
   */
  private startSession(): void {
    if (this.disposed || !SpeechCtor) return
    const r = new SpeechCtor()
    this.recognition = r
    r.continuous = true; r.interimResults = true; r.lang = 'zh-CN'; r.maxAlternatives = 1

    r.onresult = (ev: any) => {
      if (this.disposed) return
      let final = '', interim = ''

      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]; if (!res) continue
        const t = res[0]?.transcript ?? ''
        if (res.isFinal) {
          final += t
          this.finalText += t
        } else {
          interim += t
        }
      }

      // 检测临时文本的完整性（共享启发式）
      const interimComplete = shouldPromoteWebSpeechInterimToFinal(interim)

      if (final || interim) {
        const enhancedResult = this.finalText + interim
        const isEnhancedFinal = !interim && interimComplete

        this.eventBus.emit('transcript', { text: enhancedResult, isFinal: isEnhancedFinal })
      }
    }

    r.onerror = (ev: any) => {
      if (this.disposed) return
      if (ev.error === 'no-speech' || ev.error === 'aborted') return
      this.eventBus.emit('error', { message: `识别错误: ${ev.error}` })
    }

    r.onend = () => {
      if (this.disposed) return
      // 非用户主动停止 → 视为 Provider 端正常结束，触发 end 事件
      if (!this.userStopped) this.eventBus.emit('end', { text: this.finalText.trim() })
    }

    try {
      this.eventBus.emit('state', { state: 'connecting', message: '连接识别引擎...' })
      r.start()
    } catch {
      this.eventBus.emit('error', { message: '启动失败' })
    }
  }

  /** 主动停止识别，返回最终累积文本 */
  async stop(): Promise<string> {
    this.userStopped = true
    try { this.recognition?.stop() } catch {}
    await new Promise(r => setTimeout(r, 150))
    return this.finalText.trim()
  }

  /** 取消识别，丢弃累积结果 */
  async cancel(): Promise<void> {
    this.userStopped = true
    try { this.recognition?.abort() } catch {}
    this.finalText = ''
  }

  /** 释放资源 */
  dispose(): void {
    this.disposed = true
    try { this.recognition?.abort() } catch {}
    this.recognition = null
    this.eventBus.clear()
  }

}

/**
 * 检测浏览器是否支持 Web Speech API
 *
 * @returns true 表示当前浏览器支持 SpeechRecognition
 */
export function isWebSpeechSupported(): boolean {
  return !!SpeechCtor
}
