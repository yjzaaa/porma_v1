/**
 * 语音采集模块（AudioHub + VAD + Session）
 */

import type { VoiceEventLogger } from '../../events'
import type { VoiceDictationSettings } from '@/types/settings'
import type { ASRProvider } from '../../types/asr'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import type { PcmFrame } from '../../types/panel'
import { createASRProvider } from '../../asr/factory'
import { AudioHub } from '../runtime/AudioHub'
import { Session } from '../runtime/Session'
import { VADDetector } from '../runtime/VADDetector'

export class VoiceCaptureModule {
  /** 统一麦克风采集中心 */
  private readonly hub = new AudioHub()
  /** 语音活动检测器 */
  private readonly vad = new VADDetector()
  /** 事件退订列表 */
  private readonly unsubs: Array<() => void> = []

  /** 当前语音设置快照 */
  private settings: VoiceDictationSettings | null = null
  /** 当前活跃录音会话 */
  private session: Session | null = null
  /** VAD 订阅取消函数 */
  private unsubVAD: (() => void) | null = null
  /** 免提开关状态 */
  private handsfreeEnabled = false

  constructor(
    private readonly bus: VoiceDomainEventBus,
    private readonly logger: VoiceEventLogger,
  ) {
    this.unsubs.push(
      this.bus.on('command.toggle_handsfree', ({ settings }) => {
        this.settings = settings
        if (settings.handsfreeEnabled && settings.enabled) {
          this.enableHandsfree().catch(() => {})
          return
        }
        this.disableHandsfree()
      }),
      this.bus.on('command.stop_recording', () => {
        this.stopRecording().catch(() => {})
      }),
      this.bus.on('command.destroy', () => {
        this.disableHandsfree()
      }),
    )
  }

  /**
   * 手动停止当前录音会话
   *
   * 仅转发给 Session，不直接发布额外事件，避免重复转写。
   */
  async stopRecording(): Promise<void> {
    if (!this.session) return
    await this.session.stop().catch(() => '')
  }

  /**
   * 取消当前会话（幂等）
   */
  cancelSession(): void {
    if (!this.session) return
    this.session.cancel()
    this.session = null
  }

  /**
   * 是否处于免提模式
   */
  isHandsfreeEnabled(): boolean {
    return this.settings?.handsfreeEnabled === true
  }

  /**
   * 释放采集模块资源
   */
  dispose(): void {
    this.unsubs.forEach((unsub) => unsub())
    this.disableHandsfree()
  }

  /**
   * 开启免提链路：AudioHub + VAD 订阅
   *
   * 成功后发布 `handsfree.enabled`，失败发布 `handsfree.failed`。
   */
  private async enableHandsfree(): Promise<void> {
    if (this.handsfreeEnabled) {
      this.logger.debug('已经处于handsfree开启状态，跳过')
      return
    }

    this.vad.reset()
    try {
      await this.hub.start()
    } catch (error) {
      this.logger.error('麦克风启动失败', { error })
      this.bus.emit('handsfree.failed', { message: '麦克风不可用', error })
      return
    }

    this.handsfreeEnabled = true
    this.bus.emit('handsfree.enabled', { settings: this.settings! })

    this.unsubVAD = this.hub.subscribe((frame: PcmFrame) => this.detectSpeech(frame))
  }

  /**
   * 关闭免提链路并回收资源
   */
  private disableHandsfree(): void {
    this.handsfreeEnabled = false
    this.cancelSession()
    this.unsubVAD?.()
    this.unsubVAD = null
    this.hub.stop()
    this.vad.reset()
    this.bus.emit('handsfree.disabled', undefined)
  }

  /**
   * VAD 检测入口
   *
   * 仅在 `onSpeechStart` 时触发 Session 启动。
   */
  private detectSpeech(frame: PcmFrame): void {
    if (!this.handsfreeEnabled) return
    this.vad.process(frame)

    this.logger.debug('VAD检测结果', {
      volume: frame.peak.toFixed(4),
      isSpeaking: this.vad.isSpeaking,
      onSpeechStart: this.vad.onSpeechStart,
      onSpeechEnd: this.vad.onSpeechEnd,
    })

    if (this.vad.onSpeechStart) {
      this.logger.info('检测到语音开始，启动录音会话')
      this.startSession()
    }
  }

  /**
   * 创建并启动单轮录音会话
   */
  private startSession(): void {
    if (!this.settings) return

    if (this.session) {
      this.session.cancel()
      this.session = null
    }

    const provider = this.createProvider()
    this.logger.info('启动新录音会话', { engine: this.settings.engine })
    const session = new Session(
      (sub) => this.hub.subscribe(sub),
      this.vad,
      provider,
      this.settings,
    )
    this.bindSessionEvents(session, provider)

    this.session = session
    this.bus.emit('session.started', { engine: this.settings.engine || 'doubao' })
    session.start().catch((error) => {
      this.logger.error('启动ASR失败', { error })
      this.bus.emit('session.error', { message: 'ASR 引擎启动失败' })
    })
  }

  /**
   * Session 事件桥接到领域总线
   */
  private bindSessionEvents(session: Session, provider: ASRProvider): void {
    session.events.on('volume', (peak) => this.bus.emit('session.volume', { peak }))
    session.events.on('transcript', ({ text, isFinal }) =>
      this.bus.emit('session.transcript', { text, isFinal, provider }),
    )
    session.events.on('metadata', (message) => this.bus.emit('session.metadata', { message }))
    session.events.on('complete', (result) => {
      this.session = null
      this.bus.emit('session.complete', result)
    })
    session.events.on('error', (message) => {
      this.session = null
      this.bus.emit('session.error', { message })
    })
  }

  /**
   * 根据设置创建 ASR Provider
   */
  private createProvider(): ASRProvider {
    const engine = this.settings?.engine || 'doubao'
    return createASRProvider(engine)
  }
}
