/**
 * 语音活动检测器 — 基于 Web Audio API 能量检波
 *
 * 免提模式下常驻运行，仅计算麦克风音频能量峰值。
 * 检测到语音后立即触发录音，并在触发前通过环形缓冲区保留约 1 秒的音频，
 * 新录音启动后先发送缓冲区中的历史音频，再发送实时流，避免丢开头。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AudioContextCtor = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined

export type DetectorState = 'inactive' | 'listening' | 'hearing' | 'activating'

const TARGET_SAMPLE_RATE = 16000
/** 环形缓冲区大小：1.5 秒的 16-bit PCM 数据 */
const BUFFER_DURATION_SEC = 1.5
const BUFFER_SIZE = Math.floor(TARGET_SAMPLE_RATE * BUFFER_DURATION_SEC)

interface VoiceActivityDetectorOptions {
  onActivate: (audioBuffer: ArrayBuffer) => void
  onEnergy?: (peak: number) => void
  onStateChange?: (state: DetectorState) => void
  threshold?: number
  cooldownMs?: number
}

export class VoiceActivityDetector {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private running = false
  private lastActivateAt = 0

  /** 环形缓冲区：16-bit PCM，单声道，16000Hz */
  private ringBuffer = new Int16Array(BUFFER_SIZE)
  private ringIndex = 0

  /** 最近一帧的峰值（实时能量回调） */
  private lastPeak = 0
  /** 连续检测到语音的 ScriptProcessor 帧数（每帧约 46ms @16000Hz, 2048 样本） */
  private consecutiveSpeechFrames = 0
  /** 触发所需连续语音帧数，默认 3（约 138ms），过滤咳嗽/关门等短促噪音 */
  private readonly requiredSpeechFrames: number

  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly onActivate: (audioBuffer: ArrayBuffer) => void
  private readonly onEnergy?: (peak: number) => void
  private readonly onStateChange?: (state: DetectorState) => void

  private _state: DetectorState = 'inactive'

  constructor(options: VoiceActivityDetectorOptions) {
    this.onActivate = options.onActivate
    this.onEnergy = options.onEnergy
    this.onStateChange = options.onStateChange
    this.threshold = options.threshold ?? 0.05
    this.cooldownMs = options.cooldownMs ?? 4000
    this.requiredSpeechFrames = 3
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.setState('listening')
    this.startCapture().catch(() => {
      this.running = false
      this.setState('inactive')
    })
  }

  stop(): void {
    this.running = false
    this.processor?.disconnect()
    this.processor = null
    this.audioContext?.close().catch(() => {})
    this.audioContext = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.setState('inactive')
  }

  get isRunning(): boolean {
    return this.running
  }

  get state(): DetectorState {
    return this._state
  }

  private setState(state: DetectorState): void {
    if (this._state === state) return
    this._state = state
    this.onStateChange?.(state)
  }

  /** 提取环形缓冲区中的历史音频（16-bit PCM, 16000Hz, 单声道）并清空缓冲区 */
  extractBuffer(): ArrayBuffer {
    const copy = new Int16Array(BUFFER_SIZE)
    // 环形缓冲区从 ringIndex 到末尾是较旧的数据，0 到 ringIndex 是较新的数据
    const older = this.ringBuffer.subarray(this.ringIndex)
    const newer = this.ringBuffer.subarray(0, this.ringIndex)
    copy.set(older, 0)
    copy.set(newer, older.length)
    this.ringBuffer.fill(0)
    this.ringIndex = 0
    return copy.buffer
  }

  private async startCapture(): Promise<void> {
    if (!AudioContextCtor) {
      console.warn('[免提] AudioContext 不可用')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('[免提] getUserMedia 不可用')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
      })
    } catch (err) {
      console.warn('[免提] 获取麦克风失败:', err)
      throw err
    }

    if (!this.running) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    this.stream = stream
    const audioContext = new AudioContextCtor()
    this.audioContext = audioContext
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(2048, 1, 1)
    this.processor = processor
    const sink = audioContext.createAnalyser()
    source.connect(processor)
    processor.connect(sink)

    processor.onaudioprocess = (event) => {
      if (!this.running) return
      const input = event.inputBuffer.getChannelData(0)

      // 计算峰值（与 Phase 1 VAD 一致）
      let peak = 0
      for (let i = 0; i < input.length; i += 1) {
        peak = Math.max(peak, Math.abs(input[i] ?? 0))
      }
      this.onEnergy?.(peak)

      // 写入环形缓冲区（float → 16-bit PCM）
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i] ?? 0))
        this.ringBuffer[this.ringIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        this.ringIndex = (this.ringIndex + 1) % BUFFER_SIZE
      }

      // 语音检测
      const now = performance.now()
      const isSpeech = peak >= this.threshold
      const cooldownActive = now - this.lastActivateAt < this.cooldownMs

      if (cooldownActive) {
        this.consecutiveSpeechFrames = 0
      } else if (isSpeech) {
        this.consecutiveSpeechFrames++
        if (this.consecutiveSpeechFrames >= this.requiredSpeechFrames) {
          this.consecutiveSpeechFrames = 0
          this.lastActivateAt = now
          this.setState('activating')
          const buf = this.extractBuffer()
          this.onActivate(buf)
        } else {
          this.setState('hearing')
        }
      } else {
        this.consecutiveSpeechFrames = 0
        if (!isSpeech && (this._state === 'hearing' || this._state === 'activating')) {
          this.setState('listening')
        }
      }
    }
  }
}

export function isVoiceActivityDetectionSupported(): boolean {
  return !!AudioContextCtor && !!navigator.mediaDevices?.getUserMedia
}
