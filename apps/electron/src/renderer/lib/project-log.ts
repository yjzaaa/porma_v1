/**
 * 项目日志写入工具
 *
 * 将调试信息写入主进程维护的日志文件，同时保留控制台输出。
 */

type ProjectLogLevel = 'INFO' | 'WARN' | 'ERROR'

interface ProjectLogPayload {
  /** 模块名 */
  module: string
  /** 日志级别 */
  level: ProjectLogLevel
  /** 日志内容 */
  message: string
  /** 附加数据 */
  data?: unknown
}

function formatPayload(payload: ProjectLogPayload): string {
  const timestamp = new Date().toISOString()
  const dataPart = payload.data === undefined ? '' : ` ${JSON.stringify(payload.data)}`
  return `[${timestamp}] [${payload.level}] [${payload.module}] ${payload.message}${dataPart}`
}

async function writePayload(payload: ProjectLogPayload): Promise<void> {
  const logLine = formatPayload(payload)

  switch (payload.level) {
    case 'ERROR':
      console.error(logLine, payload.data ?? '')
      break
    case 'WARN':
      console.warn(logLine, payload.data ?? '')
      break
    default:
      console.info(logLine, payload.data ?? '')
      break
  }

  if (typeof window === 'undefined' || !window.electronAPI?.writeProjectLog) return
  await window.electronAPI.writeProjectLog(logLine)
}

/** 写入项目调试日志 */
export function logProjectInfo(module: string, message: string, data?: unknown): void {
  void writePayload({ module, level: 'INFO', message, data })
}

/** 写入项目警告日志 */
export function logProjectWarn(module: string, message: string, data?: unknown): void {
  void writePayload({ module, level: 'WARN', message, data })
}

/** 写入项目错误日志 */
export function logProjectError(module: string, message: string, data?: unknown): void {
  void writePayload({ module, level: 'ERROR', message, data })
}
