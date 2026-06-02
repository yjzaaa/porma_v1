/**
 * 语音采集模块（AudioHub + VAD + Session）
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDictationSettings } from '@/types/settings'
import type { ASRProvider } from '../../types/asr'
import type { VoiceDomainEventBus } from '../bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../bus/VoiceDomainEventKeys'
import { VoiceAsrTransportBus } from '../bus/VoiceAsrTransportBus'
import type { PcmFrame } from '../../types/panel'
import { createASRProvider } from '../../asr/factory'
import { AudioHub } from '../runtime/AudioHub'
import { Session } from '../runtime/Session'
import { VADDetector } from '../runtime/VADDetector'
import {
  SESSION_EVENT_COMPLETE,
  SESSION_EVENT_ERROR,
  SESSION_EVENT_METADATA,
  SESSION_EVENT_TRANSCRIPT,
  SESSION_EVENT_VOLUME,
} from '../bus/SessionEventKeys'
import { VoiceAsrTransportModule } from './VoiceAsrTransportModule'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceCaptureModule extends BaseVoiceModule {
  /** 统一麦克风采集中心 */
  private readonly hub = new AudioHub()
  /** 语音活动检测器 */
  private readonly vad = new VADDetector()
  /** 会话完成等待器 */
  private readonly completionWaiters = new Map<Session, { resolve: () => void }>()

  /** 当前语音设置快照 */
  private settings: VoiceDictationSettings | null = null
  /** 当前活跃录音会话 */
  private session: Session | null = null
  /** VAD 订阅取消函数 */
  private unsubVAD: (() => void) | null = null
  /** 免提开关状态 */
  private handsfreeEnabled = false
  /** ASR 对外交互总线 */
  private readonly transportBus = new VoiceAsrTransportBus()
  /** ASR 对外交互模块 */
  private readonly transportModule = new VoiceAsrTransportModule(this.transportBus)

  constructor(
    bus: VoiceDomainEventBus,
    logger: VoiceEventLogger,
  ) {
    super(bus, logger)
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, ({ settings }) => {
      this.settings = settings
      if (settings.handsfreeEnabled && settings.enabled) {
        this.enableHandsfree().catch(() => {})
        return
      }
      this.disableHandsfree()
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, () => {
      this.stopRecording().catch(() => {})
    })
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.destroy, () => {
      this.disableHandsfree()
    })
  }

  /**
   * 手动停止当前录音会话
   *
   * 仅转发给 Session，不直接发布额外事件，避免重复转写。
   */
  async stopRecording(): Promise<void> {
    if (!this.session) return
    const session = this.session
    const wait = this.waitForSessionCompletion(session)
    await session.stop().catch(() => '')
    await wait
  }

  /**
   * 取消当前会话（幂等）
   */
  cancelSession(): void {
    if (!this.session) return
    const session = this.session
    this.session.cancel()
    this.session = null
    this.resolveSessionCompletion(session)
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
    this.disposeSubscriptions()
    this.disableHandsfree()
    this.completionWaiters.clear()
    this.transportModule.dispose()
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
      this.emit(VOICE_DOMAIN_EVENT_KEYS.handsfree.failed, { message: '麦克风不可用', error })
      return
    }

    this.handsfreeEnabled = true
    this.emit(VOICE_DOMAIN_EVENT_KEYS.handsfree.enabled, { settings: this.settings! })

    this.unsubVAD = this.hub.subscribe((frame: PcmFrame) => {
      this.session?.pushAudio(frame)
      this.detectSpeech(frame)
    })
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
    this.emit(VOICE_DOMAIN_EVENT_KEYS.handsfree.disabled, undefined)
  }

  /**
   * VAD 检测入口
   *
   * 仅在 `onSpeechStart` 时触发 Session 启动。
   */
  private detectSpeech(frame: PcmFrame): void {
    if (!this.handsfreeEnabled) return
    this.vad.process(frame)

    // this.logger.debug('VAD检测结果', {
    //   volume: frame.peak.toFixed(4),
    //   isSpeaking: this.vad.isSpeaking,
    //   onSpeechStart: this.vad.onSpeechStart,
    //   onSpeechEnd: this.vad.onSpeechEnd,
    // })

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

    // 单会话模式：录音过程中不允许被新的 onSpeechStart 打断重建
    if (this.session && !this.session.disposed) {
      this.logger.debug('已有活跃录音会话，忽略本次启动请求')
      return
    }

    const provider = this.createProvider()
    this.logger.info('启动新录音会话', { engine: this.settings.engine })
    const session = new Session(provider)
    this.bindSessionEvents(session, provider)

    this.session = session
    this.emit(VOICE_DOMAIN_EVENT_KEYS.session.started, { engine: this.settings.engine || 'doubao' })
    session.start().catch((error) => {
      this.logger.error('启动ASR失败', { error })
      this.emit(VOICE_DOMAIN_EVENT_KEYS.session.error, { message: 'ASR 引擎启动失败' })
    })
  }

  /**
   * Session 事件桥接到领域总线
   */
  private bindSessionEvents(session: Session, provider: ASRProvider): void {
    session.events.on(SESSION_EVENT_VOLUME, (peak) => this.emit(VOICE_DOMAIN_EVENT_KEYS.session.volume, { peak }))
    session.events.on(SESSION_EVENT_TRANSCRIPT, ({ text, isFinal }) =>
      this.emit(VOICE_DOMAIN_EVENT_KEYS.session.transcript, { text, isFinal, provider }),
    )
    session.events.on(SESSION_EVENT_METADATA, (message) => this.emit(VOICE_DOMAIN_EVENT_KEYS.session.metadata, { message }))
    session.events.on(SESSION_EVENT_COMPLETE, ({ text }) => {
      void this.handleSessionComplete(session, text)
    })
    session.events.on(SESSION_EVENT_ERROR, (message) => {
      if (this.session !== session) {
        this.logger.debug('忽略过期会话的错误事件')
        this.resolveSessionCompletion(session)
        return
      }
      this.session = null
      this.emit(VOICE_DOMAIN_EVENT_KEYS.session.error, { message })
      this.resolveSessionCompletion(session)
    })
  }

  /**
   * 根据设置创建 ASR Provider
   */
  private createProvider(): ASRProvider {
    const engine = this.settings?.engine || 'doubao'
    return createASRProvider(engine, this.transportBus)
  }

  /**
   * 处理会话完成：提交文本到主进程并广播领域事件。
   */
  private async handleSessionComplete(session: Session, text: string): Promise<void> {
    if (this.session !== session) {
      this.logger.debug('忽略过期会话的完成事件')
      this.resolveSessionCompletion(session)
      return
    }

    const trimmed = text.trim()
    let commitMessage = ''

    if (trimmed) {
      try {
        const result = await window.electronAPI.commitVoiceDictation({ text: trimmed })
        commitMessage = result.message
      } catch (error) {
        this.logger.error('提交语音文本失败', {
          error: error instanceof Error ? error.message : '未知错误',
        })
        this.emit(VOICE_DOMAIN_EVENT_KEYS.session.error, { message: '输出失败' })
        this.session = null
        this.resolveSessionCompletion(session)
        return
      }
    }

    this.session = null
    this.emit(VOICE_DOMAIN_EVENT_KEYS.session.complete, {
      text: trimmed,
      commitMessage,
    })
    this.resolveSessionCompletion(session)
  }

  /**
   * 等待指定会话完成提交。
   */
  private waitForSessionCompletion(session: Session): Promise<void> {
    return new Promise((resolve) => {
      const existing = this.completionWaiters.get(session)
      if (existing) {
        existing.resolve()
      }
      this.completionWaiters.set(session, { resolve })
    })
  }

  /**
   * 结束指定会话的完成等待。
   */
  private resolveSessionCompletion(session: Session): void {
    const waiter = this.completionWaiters.get(session)
    if (!waiter) return
    this.completionWaiters.delete(session)
    waiter.resolve()
  }
}
