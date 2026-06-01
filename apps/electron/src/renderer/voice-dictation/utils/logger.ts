/**
 * 语音模块日志工具
 *
 * 提供统一的日志格式和级别管理，支持文件日志
 */
export class VoiceLogger {
  private module: string
  private enabled: boolean = true
  private logFileEnabled: boolean = true
  private logBuffer: string[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(module: string) {
    this.module = module
    // 启动日志文件写入
    this.initFileLogging()
  }

  /**
   * 初始化文件日志
   */
  private initFileLogging(): void {
    if (!this.logFileEnabled) return

    // 每5秒刷新日志到文件
    this.flushTimer = setInterval(() => {
      this.flushToFile()
    }, 5000)
  }

  /**
   * 刷新日志缓冲到文件
   */
  private async flushToFile(): Promise<void> {
    if (this.logBuffer.length === 0) return

    const logs = this.logBuffer.join('\n')
    this.logBuffer = []

    try {
      // 通过IPC写入日志文件
      if (window.electronAPI?.writeVoiceDictationLog) {
        await window.electronAPI.writeVoiceDictationLog(logs)
      }
    } catch (error) {
      console.error('[VoiceLogger] 写入日志文件失败:', error)
    }
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

    // 控制台输出
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

    // 添加到文件日志缓冲
    if (this.logFileEnabled) {
      const dataStr = data ? ` ${JSON.stringify(data)}` : ''
      this.logBuffer.push(`${formattedMessage}${dataStr}`)

      // 如果缓冲过大，立即刷新
      if (this.logBuffer.length >= 50) {
        this.flushToFile()
      }
    }
  }

  /**
   * 启用/禁用日志
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * 启用/禁用文件日志
   */
  setFileEnabled(enabled: boolean): void {
    this.logFileEnabled = enabled
  }

  /**
   * 销毁日志器
   */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // 最后刷新一次
    this.flushToFile()
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
