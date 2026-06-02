/**
 * 系统文本插入服务
 *
 * 通过临时剪贴板 + 系统粘贴快捷键，把文本写入当前前台应用的光标位置。
 */

import { clipboard, systemPreferences } from 'electron'
import type { NativeImage } from 'electron'
import { execFile } from 'child_process'
import { setTimeout as sleep } from 'timers/promises'

const CLIPBOARD_READY_DELAY_MS = 80
const CLIPBOARD_RESTORE_DELAY_MS = 10_000
const MAC_PASTE_TIMEOUT_MS = 2_000
const WINDOWS_PASTE_TIMEOUT_MS = 3_000

interface ClipboardSnapshot {
  text: string
  html: string
  rtf: string
  image: NativeImage | null
  buffers: ClipboardBufferSnapshot[]
}

interface ClipboardBufferSnapshot {
  format: string
  buffer: Buffer
}

interface ExecError extends Error {
  code?: unknown
  signal?: unknown
  killed?: boolean
  stderr?: string
}

export interface TextInsertionResult {
  success: boolean
  mode: 'cursor' | 'clipboard'
  message: string
  error?: string
}

/** 优先粘贴到当前光标位置，失败时保留文本在剪贴板。 */
export async function pasteTextAtCurrentCursor(text: string): Promise<TextInsertionResult> {
  const snapshot = captureClipboardSnapshot()
  clipboard.writeText(text)

  try {
    await sleep(CLIPBOARD_READY_DELAY_MS)
    await triggerSystemPaste()
    scheduleClipboardRestore(snapshot, text)
    return {
      success: true,
      mode: 'cursor',
      message: '已写入当前光标位置',
    }
  } catch (error) {
    const message = getErrorMessage(error)
    console.warn('[语音输入] 自动粘贴失败，已保留文本到剪贴板:', message)
    return {
      success: false,
      mode: 'clipboard',
      message: '自动粘贴失败，已复制到剪贴板',
      error: message,
    }
  }
}

function captureClipboardSnapshot(): ClipboardSnapshot {
  const image = clipboard.readImage()
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: image.isEmpty() ? null : image,
    buffers: captureClipboardBuffers(),
  }
}

function captureClipboardBuffers(): ClipboardBufferSnapshot[] {
  const snapshots: ClipboardBufferSnapshot[] = []
  for (const format of clipboard.availableFormats()) {
    try {
      const buffer = clipboard.readBuffer(format)
      if (buffer.byteLength > 0) {
        snapshots.push({ format, buffer })
      }
    } catch {
      // 某些系统私有格式无法通过 Electron 读取，跳过即可。
    }
  }
  return snapshots
}

function scheduleClipboardRestore(snapshot: ClipboardSnapshot, insertedText: string): void {
  const timer = setTimeout(() => {
    try {
      if (clipboard.readText() !== insertedText) return
      restoreClipboardSnapshot(snapshot)
    } catch (error) {
      console.warn('[语音输入] 恢复剪贴板失败:', getErrorMessage(error))
    }
  }, CLIPBOARD_RESTORE_DELAY_MS)
  timer.unref?.()
}

function restoreClipboardSnapshot(snapshot: ClipboardSnapshot): void {
  if (!snapshot.text && !snapshot.html && !snapshot.rtf && !snapshot.image) {
    if (restoreClipboardBuffers(snapshot.buffers)) return
    clipboard.clear()
    return
  }

  clipboard.write({
    text: snapshot.text || undefined,
    html: snapshot.html || undefined,
    rtf: snapshot.rtf || undefined,
    image: snapshot.image || undefined,
  })
}

function restoreClipboardBuffers(buffers: ClipboardBufferSnapshot[]): boolean {
  if (buffers.length === 0) return false

  clipboard.clear()
  let restored = false
  for (const item of buffers) {
    try {
      clipboard.writeBuffer(item.format, item.buffer)
      restored = true
    } catch {
      // 写回失败时继续尝试其他格式，最后还有结构化格式兜底。
    }
  }
  return restored
}

async function triggerSystemPaste(): Promise<void> {
  if (process.platform === 'darwin') {
    await triggerMacPaste()
    return
  }

  if (process.platform === 'win32') {
    await triggerWindowsPaste()
    return
  }

  throw new Error('当前系统暂不支持自动粘贴')
}

async function triggerMacPaste(): Promise<void> {
  if (!systemPreferences.isTrustedAccessibilityClient(true)) {
    throw new Error('需要在 macOS 系统设置中允许 Proma 使用辅助功能')
  }

  await execFileAsync(
    '/usr/bin/osascript',
    ['-e', 'tell application "System Events" to keystroke "v" using command down'],
    MAC_PASTE_TIMEOUT_MS,
  )
}

async function triggerWindowsPaste(): Promise<void> {
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      WINDOWS_SEND_INPUT_SCRIPT,
    ],
    WINDOWS_PASTE_TIMEOUT_MS,
  )
}

function execFileAsync(file: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        const execError = error as ExecError
        execError.stderr = stderr
        reject(execError)
        return
      }
      resolve()
    })
  })
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const execError = error as ExecError
    return execError.stderr?.trim() || error.message
  }
  return String(error)
}

const WINDOWS_SEND_INPUT_SCRIPT = String.raw`
try {
  $ws = New-Object -ComObject WScript.Shell
  $ws.SendKeys("^v")
} catch {
  throw "SendKeys failed: $($_.Exception.Message)"
}
`
