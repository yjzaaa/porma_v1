/**
 * 【第 4 层 - 业务模块层】语音采集模块（AudioHub + VAD + Session）
 *
 * 职责：管理麦克风采集、VAD 检测、录音会话生命周期
 */

import type { VoiceEventLogger } from '../../ui-events'
import type { VoiceDictationSettings } from '@/types/settings'
import type { ASRProvider } from '../../shared/types/asr'
import type { VoiceDomainEventBus } from '../../shared/bus/VoiceDomainEventBus'
import { VOICE_DOMAIN_EVENT_KEYS } from '../../shared/bus/VoiceDomainEventKeys'
import type { VoiceAsrTransportBus } from '../../shared/bus/VoiceAsrTransportBus'
import type { VoiceDictationIpcBridge } from '../../shared/types/voice-dictation-ipc'
import type { PcmFrame } from '../../shared/types/panel'
import { createASRProvider } from '../../asr'
import { AudioHub } from '../runtime/AudioHub'
import { VoiceRecordingSession } from '../runtime/VoiceRecordingSession'
import { VADDetector } from '../runtime/VADDetector'
import {
  SESSION_EVENT_COMPLETE,
  SESSION_EVENT_ERROR,
  SESSION_EVENT_METADATA,
  SESSION_EVENT_TRANSCRIPT,
  SESSION_EVENT_VOLUME,
} from '../../shared/bus/SessionEventKeys'
import { BaseVoiceModule } from './BaseVoiceModule'

export class VoiceCaptureModule extends BaseVoiceModule {
  /** 统一麦克风采集中心 */
  private readonly hub = new AudioHub()
  /** 语音活动检测器 */
  private readonly vad = new VADDetector()
  /** 当前语音设置快照 */
  private settings: VoiceDictationSettings | null = null
  /** 当前活跃录音会话 */
  private session: VoiceRecordingSession | null = null
  /** VAD 订阅取消函数 */
  private unsubVAD: (() => void) | null = null
  /** 免提开关状态 */
  private handsfreeEnabled = false
  /** ASR 对外交互总线（由外部注入） */
  private readonly transportBus: VoiceAsrTransportBus

  constructor(
    bus: VoiceDomainEventBus,
    logger: VoiceEventLogger,
    transportBus: VoiceAsrTransportBus,
    private readonly commitVoiceDictation: VoiceDictationIpcBridge['commitVoiceDictation'],
  ) {
    super(bus, logger)
    this.transportBus = transportBus

    // === 订阅免提切换命令 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.toggleHandsfree, ({ settings }) => {
      this.settings = settings
      if (settings.handsfreeEnabled && settings.enabled) {
        this.logger.info('🎤 启用免提模式', { settings })
        this.enableHandsfree().catch(() => {})
        return
      }
      this.logger.info('🔇 禁用免提模式')
      this.disableHandsfree()
    })

    // === 订阅停止录音命令 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.stopRecording, () => {
      this.logger.info('⏹️ 收到停止录音命令')
      this.stopRecording().catch(() => {})
    })

    // === 订阅取消录音命令 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.cancelRecording, () => {
      this.logger.info('🛑 收到取消录音命令')
      this.cancelSession()
    })

    // === 订阅销毁命令 ===
    this.on(VOICE_DOMAIN_EVENT_KEYS.command.destroy, () => {
      this.logger.info('💥 收到销毁命令')
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
    await session.stop().catch(() => '')
    await session.waitUntilSettled()
  }

  /**
   * 取消当前会话（幂等）
   */
  cancelSession(): void {
    if (!this.session) return
    const session = this.session
    this.session.cancel()
    this.session = null
    session.settle()
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
  }

  /**
   * 开启免提链路：AudioHub + VAD 订阅
   *
   * 流程：
   *   🎤 检查状态
   *   🎚️ 启动音频采集
   *   ✅ 成功后发布事件
   *   🔄 订阅PCM帧流
   */
  private async enableHandsfree(): Promise<void> {
    // === 🎤 第1步：检查当前状态 ===
    if (this.handsfreeEnabled) {
      this.logger.debug('🔄 已经处于免提开启状态，跳过')
      return
    }

    // === 🎚️ 第2步：重置VAD并启动音频采集 ===
    this.logger.info('🎚️ 启动音频采集')
    this.vad.reset()

    try {
      await this.hub.start()
    } catch (error) {
      // === ❌ 采集启动失败 ===
      this.logger.error('❌ 麦克风启动失败', { error })
      this.emit(VOICE_DOMAIN_EVENT_KEYS.handsfree.failed, {
        message: '麦克风不可用',
        error,
      })
      return
    }

    // === ✅ 第3步：发布成功事件 ===
    this.handsfreeEnabled = true
    this.logger.info('✅ 免提模式已启用')
    this.emit(VOICE_DOMAIN_EVENT_KEYS.handsfree.enabled, {
      settings: this.settings!,
    })

    // === 🔄 第4步：订阅PCM帧流 ===
    this.unsubVAD = this.hub.subscribe((frame: PcmFrame) => {
      // 将音频帧推送到会话
      this.session?.pushAudio(frame)
      // 进行VAD检测
      this.detectSpeech(frame)
    })

    this.logger.info('📡 PCM帧流订阅已建立')
  }

  /**
   * 关闭免提链路并回收资源
   *
   * 流程：
   *   🔇 关闭免提状态
   *   ⏹️ 停止会话
   *   📡 取消PCM订阅
   *   🎚️ 停止音频采集
   *   🔄 重置VAD
   *   ✅ 发布关闭事件
   */
  private disableHandsfree(): void {
    // === 🔇 第1步：关闭免提状态 ===
    this.handsfreeEnabled = false

    // === ⏹️ 第2步：停止当前会话 ===
    this.cancelSession()

    // === 📡 第3步：取消PCM帧流订阅 ===
    this.unsubVAD?.()
    this.unsubVAD = null

    // === 🎚️ 第4步：停止音频采集 ===
    this.hub.stop()

    // === 🔄 第5步：重置VAD ===
    this.vad.reset()

    // === ✅ 第6步：发布关闭事件 ===
    this.logger.info('✅ 免提模式已禁用')
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
    const session = new VoiceRecordingSession(provider)
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
  private bindSessionEvents(session: VoiceRecordingSession, provider: ASRProvider): void {
    session.events.on(SESSION_EVENT_VOLUME, (peak) => this.emit(VOICE_DOMAIN_EVENT_KEYS.session.volume, { peak }))
    session.events.on(SESSION_EVENT_TRANSCRIPT, ({ text, isFinal }) => {
      this.logger.debug('🎤 CaptureModule 收到转写事件', { text: text.substring(0, 20), isFinal })
      this.emit(VOICE_DOMAIN_EVENT_KEYS.session.transcript, { text, isFinal, provider })
    })
    session.events.on(SESSION_EVENT_METADATA, (message) => this.emit(VOICE_DOMAIN_EVENT_KEYS.session.metadata, { message }))
    session.events.on(SESSION_EVENT_COMPLETE, ({ text }) => {
      void this.handleSessionComplete(session, text)
    })
    session.events.on(SESSION_EVENT_ERROR, (message) => {
      if (this.session !== session) {
        this.logger.debug('忽略过期会话的错误事件')
        session.settle()
        return
      }
      this.logger.warn('会话出错', { message })
      this.session = null
      this.emit(VOICE_DOMAIN_EVENT_KEYS.session.error, { message })
      session.settle()

      // 🔧 免提模式下，如果用户仍在说话，立即重启会话
      if (this.handsfreeEnabled && this.vad.isSpeaking) {
        this.logger.info('用户仍在说话，立即重启会话')
        // 延迟一小段时间确保旧会话完全释放
        setTimeout(() => {
          if (this.handsfreeEnabled && !this.session) {
            this.startSession()
          }
        }, 100)
      }
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
  private async handleSessionComplete(session: VoiceRecordingSession, text: string): Promise<void> {
    if (this.session !== session) {
      this.logger.debug('忽略过期会话的完成事件')
      session.settle()
      return
    }

    const trimmed = text.trim()
    let commitMessage = ''

    if (trimmed) {
      try {
        const result = await this.commitVoiceDictation({ text: trimmed })
        commitMessage = result.message
      } catch (error) {
        this.logger.error('提交语音文本失败', {
          error: error instanceof Error ? error.message : '未知错误',
        })
        this.emit(VOICE_DOMAIN_EVENT_KEYS.session.error, { message: '输出失败' })
        this.session = null
        session.settle()
        return
      }
    }

    this.session = null
    this.emit(VOICE_DOMAIN_EVENT_KEYS.session.complete, {
      text: trimmed,
      commitMessage,
    })
    session.settle()
  }
}
