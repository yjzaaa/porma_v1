/**
 * 语音模块日志事件（统一定义）
 */

import { createLogger, type VoiceLogger, type VoiceLoggerOptions } from '../utils/logger'

export type VoiceLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface VoiceLogEvent {
  level: VoiceLogLevel
  message: string
  data?: Record<string, unknown>
}

export type VoiceLogEventListener = (event: VoiceLogEvent) => void

export interface VoiceEventLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

export class VoiceLogEventEmitter {
  private readonly listeners = new Set<VoiceLogEventListener>()

  onEvent(listener: VoiceLogEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: VoiceLogEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export function createVoiceEventLogger(emitter: VoiceLogEventEmitter): VoiceEventLogger {
  const emit = (level: VoiceLogLevel, message: string, data?: Record<string, unknown>): void => {
    emitter.emit({ level, message, data })
  }

  return {
    debug: (message, data) => emit('debug', message, data),
    info: (message, data) => emit('info', message, data),
    warn: (message, data) => emit('warn', message, data),
    error: (message, data) => emit('error', message, data),
  }
}

export class VoiceLogEventSubscriber {
  private readonly logger: VoiceLogger
  private readonly unsubscribe: () => void

  constructor(module: string, emitter: VoiceLogEventEmitter, loggerOptions?: VoiceLoggerOptions) {
    this.logger = createLogger(module, loggerOptions)
    this.unsubscribe = emitter.onEvent((event) => this.write(event))
  }

  private write(event: VoiceLogEvent): void {
    switch (event.level) {
      case 'debug':
        this.logger.debug(event.message, event.data)
        return
      case 'info':
        this.logger.info(event.message, event.data)
        return
      case 'warn':
        this.logger.warn(event.message, event.data)
        return
      case 'error':
        this.logger.error(event.message, event.data)
        return
      default:
        this.logger.info(event.message, event.data)
    }
  }

  dispose(): void {
    this.unsubscribe()
    this.logger.dispose()
  }
}
