/**
 * 语音模块日志工具
 *
 * 提供统一的日志格式和级别管理
 */
export class VoiceLogger {
  private module: string
  private enabled: boolean = true

  constructor(module: string) {
    this.module = module
  }

  /**
   * 调试级别日志
   */
  debug(message: string, data?: any): void {
    this.log('DEBUG', message, data)
  }

  /**
   * 信息级别日志
   */
  info(message: string, data?: any): void {
    this.log('INFO', message, data)
  }

  /**
   * 警告级别日志
   */
  warn(message: string, data?: any): void {
    this.log('WARN', message, data)
  }

  /**
   * 错误级别日志
   */
  error(message: string, data?: any): void {
    this.log('ERROR', message, data)
  }

  /**
   * 核心日志方法
   */
  private log(level: string, message: string, data?: any): void {
    if (!this.enabled) return

    const timestamp = new Date().toISOString()
    const formattedMessage = `[${timestamp}] [${level}] [${this.module}] ${message}`

    switch (level) {
      case 'ERROR':
        console.error(formattedMessage, data || '')
        break
      case 'WARN':
        console.warn(formattedMessage, data || '')
        break
      case 'DEBUG':
        console.log(formattedMessage, data || '')
        break
      default:
        console.info(formattedMessage, data || '')
    }
  }

  /**
   * 启用/禁用日志
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }
}

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

/**
 * 创建模块专用logger
 */
export function createLogger(module: string): VoiceLogger {
  return new VoiceLogger(module)
}
