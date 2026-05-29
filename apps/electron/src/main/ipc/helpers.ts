/**
 * IPC 模块共享工具函数
 *
 * 从 ipc.ts 提取的通用助手：路径校验、默认应用探测、外部命令执行等。
 */

import { ipcMain, nativeTheme, shell, dialog, BrowserWindow, app } from 'electron'
import { join, resolve, sep, dirname } from 'node:path'
import { existsSync, realpathSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { FileAccessOptions } from '@proma/shared'
import { getAgentWorkspacesDir, getWorkspaceFilesDir } from '../lib/config-paths'
import { getAgentSessionMeta } from '../lib/agent-session-manager'
import { getAgentWorkspace } from '../lib/agent-workspace-manager'
import { getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles } from '../lib/agent-workspace-manager'

/** 文件浏览器中需要隐藏的系统文件 */
export const HIDDEN_FS_ENTRIES = new Set(['.DS_Store', 'Thumbs.db'])

/** 已知编辑器应用名称白名单（macOS） */
export const KNOWN_EDITORS = [
  'Visual Studio Code', 'Cursor', 'Sublime Text', 'Windsurf',
  'Zed', 'CotEditor', 'IntelliJ IDEA', 'Xcode', 'TextEdit',
]

/**
 * 检查路径是否在允许的目录范围内（解析 symlink）
 *
 * extraAllowedPaths 来自 renderer 的 basePaths（用户通过 UI 附加的目录），
 * 虽然 renderer 不可信，但附加目录功能本身就允许用户授权 workspaces 外的路径访问。
 * 攻击者需要先控制 renderer 才能伪造 basePaths，此时已有更大的攻击面。
 */
export function realpathOrResolve(path: string): string {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

export function getAuthorizedRoots(options?: FileAccessOptions): string[] {
  const roots: string[] = [
    getAgentWorkspacesDir(),
    join(tmpdir(), 'proma-preview'),
  ]

  const workspaceSlugs = new Set<string>()

  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.attachedDirectories) {
      roots.push(...meta.attachedDirectories)
    }
    if (meta?.attachedFiles) {
      roots.push(...meta.attachedFiles)
    }
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) workspaceSlugs.add(workspace.slug)
    }
  }

  if (options?.workspaceSlug) {
    workspaceSlugs.add(options.workspaceSlug)
  }

  for (const slug of workspaceSlugs) {
    roots.push(getWorkspaceFilesDir(slug))
    roots.push(...getWorkspaceAttachedDirectories(slug))
    roots.push(...getWorkspaceAttachedFiles(slug))
  }

  return roots
}

function isUnderRoot(resolvedPath: string, root: string): boolean {
  const resolvedRoot = realpathOrResolve(root)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep)
}

export function isPathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  let resolved: string
  try {
    resolved = realpathSync(resolve(filePath))
  } catch {
    return false
  }
  return getAuthorizedRoots(options).some((root) => isUnderRoot(resolved, root))
}

export function normalizeFileAccessOptions(value?: FileAccessOptions | string[]): FileAccessOptions | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined
  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    workspaceSlug: typeof value.workspaceSlug === 'string' ? value.workspaceSlug : undefined,
    candidateBasePaths: Array.isArray(value.candidateBasePaths)
      ? value.candidateBasePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : undefined,
  }
}

export function getAllowedCandidateBasePaths(options?: FileAccessOptions): string[] | undefined {
  const allowed = options?.candidateBasePaths?.filter((p) => isPathAllowed(p, options)) ?? []
  return allowed.length > 0 ? allowed : undefined
}

export function ensurePathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  if (isPathAllowed(filePath, options)) return true
  console.warn('[IPC] 拒绝越界路径:', filePath)
  return false
}

/**
 * 打包内置资源目录
 * dev: __dirname/resources（build:resources 阶段拷贝）
 * prod: process.resourcesPath（electron-builder extraResources 产物）
 */
export function getBundledResourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, 'resources')
}

/**
 * 默认 App 探测结果按文件后缀缓存（含 null 负缓存），避免反复 spawn osascript / 注册表查询。
 * 进程级别一次会话足够，无需失效策略——用户切换默认 App 是低频行为，下次重启生效即可。
 */
const defaultAppCache = new Map<string, import('@proma/shared').DefaultAppInfo | null>()

function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

async function getAppIconDataUrl(appPath: string): Promise<string> {
  if (process.platform === 'darwin' && appPath.endsWith('.app')) {
    const dataUrl = await getMacAppIconViaSips(appPath)
    if (dataUrl) return dataUrl
  }

  const icon = await app.getFileIcon(appPath, { size: 'large' })
  if (icon.isEmpty()) return ''
  return icon.toDataURL()
}

async function getMacAppIconViaSips(appPath: string): Promise<string> {
  const { existsSync, readFileSync, unlinkSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  const resourcesDir = join(appPath, 'Contents', 'Resources')
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  let iconName: string | null = null
  if (existsSync(plistPath)) {
    const r = await runCmd('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', plistPath], { timeoutMs: 2000 })
    if (r.status === 0) iconName = r.stdout.trim()
  }
  const candidates: string[] = []
  if (iconName) candidates.push(join(resourcesDir, iconName.endsWith('.icns') ? iconName : `${iconName}.icns`))
  candidates.push(join(resourcesDir, 'AppIcon.icns'), join(resourcesDir, 'app.icns'), join(resourcesDir, 'icon.icns'))
  const icnsPath = candidates.find((p) => existsSync(p))
  if (!icnsPath) return ''

  const tmp = mkdtempSync(join(tmpdir(), 'proma-icon-'))
  const outPath = join(tmp, 'icon.png')
  try {
    const r = await runCmd('sips', ['-s', 'format', 'png', '-Z', '64', icnsPath, '--out', outPath], { timeoutMs: 4000 })
    if (r.status !== 0 || !existsSync(outPath)) return ''
    const buf = readFileSync(outPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } finally {
    try { if (existsSync(outPath)) unlinkSync(outPath) } catch { /* ignore */ }
  }
}

/** 异步执行外部命令，超时即 kill；不经 shell，避免 shell 元字符注入。 */
export async function runCmd(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; stdin?: string } = {},
): Promise<{ status: number | null; stdout: string }> {
  const { spawn } = await import('node:child_process')
  const { timeoutMs = 4000, stdin } = opts
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'ignore'],
    })
    let stdout = ''
    let settled = false
    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ status, stdout })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish(null)
    }, timeoutMs)
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
    }
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin)
    }
  })
}

function parseWindowsRegistryValue(stdout: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/\s+REG_\w+\s+(.+)$/)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function expandWindowsEnvPath(filePath: string): string {
  return filePath.replace(/%([^%]+)%/g, (token, name: string) => {
    const foundKey = Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase())
    return foundKey ? process.env[foundKey] ?? token : token
  })
}

function parseWindowsExecutablePath(command: string): string {
  const match = command.match(/"([^"]+\.exe)"|([^\s"]+\.exe)/i)
  return expandWindowsEnvPath((match?.[1] || match?.[2] || '').trim())
}

function isSafeWindowsProgId(progId: string): boolean {
  return /^[a-zA-Z0-9_.+-]+$/.test(progId)
}

async function getWindowsDefaultAppCommand(progId: string): Promise<string> {
  if (!isSafeWindowsProgId(progId)) return ''

  const registryResult = await runCmd('reg', [
    'query',
    `HKCR\\${progId}\\shell\\open\\command`,
    '/ve',
  ])
  const registryCommand = parseWindowsRegistryValue(registryResult.stdout)
  if (registryCommand) return registryCommand

  const ftypeResult = await runCmd('cmd', ['/c', `ftype ${progId}`])
  return (ftypeResult.stdout || '').split('=').slice(1).join('=').trim()
}

async function getWindowsDefaultAppInfo(filePath: string): Promise<{ appPath: string; appName: string; isUwp?: boolean } | null> {
  const ext = extOf(filePath)
  if (!/^\.[a-zA-Z0-9]+$/.test(ext)) {
    console.log('[DefaultApp] ext 校验失败:', ext)
    return null
  }

  const userChoiceResult = await runCmd('reg', [
    'query',
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
    '/v',
    'ProgId',
  ])
  let progId = parseWindowsRegistryValue(userChoiceResult.stdout)

  if (!progId) {
    const assoc = await runCmd('cmd', ['/c', `assoc ${ext}`])
    progId = (assoc.stdout || '').split('=').slice(1).join('=').trim()
  }
  if (!progId) {
    const mruResult = await runCmd('reg', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\OpenWithList`,
    ])
    const mruLine = mruResult.stdout.split(/\r?\n/).find((l) => /\s+MRUList\s+REG_SZ\s+/.test(l))
    const mruOrder = mruLine?.split(/\s+REG_SZ\s+/)[1]?.trim() ?? ''
    if (mruOrder) {
      const firstKey = mruOrder[0]
      const exeLine = mruResult.stdout.split(/\r?\n/).find((l) => new RegExp(`\\s+${firstKey}\\s+REG_SZ\\s+`).test(l))
      const exeName = exeLine?.split(/\s+REG_SZ\s+/)[1]?.trim() ?? ''
      if (exeName && /^[a-zA-Z0-9 _.+()-]+\.exe$/i.test(exeName)) {
        const appName = exeName.replace(/\.exe$/i, '')
        const apResult = await runCmd('reg', [
          'query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`, '/ve',
        ])
        let exePath = parseWindowsRegistryValue(apResult.stdout)
        if (!exePath) {
          const apResult2 = await runCmd('reg', [
            'query', `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`, '/ve',
          ])
          exePath = parseWindowsRegistryValue(apResult2.stdout)
        }
        if (exePath) return { appPath: exePath, appName }
      }
    }
  }
  if (!progId) {
    const owpResult = await runCmd('reg', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\OpenWithProgids`,
    ])
    for (const line of owpResult.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s+(\S+)\s+REG_/)
      if (m && m[1] && isSafeWindowsProgId(m[1])) {
        progId = m[1]
        break
      }
    }
  }
  if (!progId || !isSafeWindowsProgId(progId)) {
    return null
  }

  if (progId.startsWith('AppX')) {
    const nameResult = await runCmd('reg', [
      'query', `HKCR\\${progId}\\Application`, '/v', 'ApplicationName',
    ])
    let appName = parseWindowsRegistryValue(nameResult.stdout)
    if (appName.startsWith('@{')) {
      const appIdResult = await runCmd('reg', [
        'query', `HKCR\\${progId}\\Application`, '/v', 'AppUserModelId',
      ])
      const appUserModelId = parseWindowsRegistryValue(appIdResult.stdout)
      const parts = appUserModelId.split('!')
      appName = (parts[1] ?? parts[0] ?? '').replace(/^Microsoft\./, '').replace(/^Windows\./, '') || 'UWP App'
    }
    return { appPath: '', appName, isUwp: true }
  }

  const command = await getWindowsDefaultAppCommand(progId)
  const appPath = parseWindowsExecutablePath(command)
  if (!appPath) {
    const rootResult = await runCmd('reg', ['query', `HKCR\\${progId}`, '/ve'])
    const rootName = parseWindowsRegistryValue(rootResult.stdout)
    const appModelResult = await runCmd('reg', ['query', `HKCR\\${progId}`, '/v', 'AppUserModelId'])
    const appModelId = parseWindowsRegistryValue(appModelResult.stdout)
    const candidateAppName = (appModelId || rootName || '').replace(/\s+(HTML?\s+)?(Document|File)$/i, '').trim()
    if (!candidateAppName || !/^[a-zA-Z0-9 _.+-]+$/.test(candidateAppName)) return null
    const appPathsResult = await runCmd('reg', [
      'query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${candidateAppName}.exe`, '/ve',
    ])
    let exePath = parseWindowsRegistryValue(appPathsResult.stdout)
    if (!exePath) {
      const appPathsResult2 = await runCmd('reg', [
        'query', `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${candidateAppName}.exe`, '/ve',
      ])
      exePath = parseWindowsRegistryValue(appPathsResult2.stdout)
    }
    if (!exePath) return null
    const base = exePath.split(/[\\/]/).pop() || ''
    return { appPath: exePath, appName: base.replace(/\.exe$/i, '') }
  }

  const base = appPath.split(/[\\/]/).pop() || ''
  return { appPath, appName: base.replace(/\.exe$/i, '') }
}

export async function getDefaultAppInfoForFile(
  filePath: string,
  _options?: FileAccessOptions,
): Promise<import('@proma/shared').DefaultAppInfo | null> {
  const { resolve } = await import('node:path')
  const absPath = resolve(filePath)

  const cacheKey = `${process.platform}:${extOf(filePath) || filePath}`
  if (defaultAppCache.has(cacheKey)) return defaultAppCache.get(cacheKey) ?? null

  let appPath = ''
  let appName = ''

  if (process.platform === 'darwin') {
    const swiftSrc = `import Foundation
import AppKit
let path = CommandLine.arguments.dropFirst().first ?? ""
let url = URL(fileURLWithPath: path)
if let appUrl = NSWorkspace.shared.urlForApplication(toOpen: url) {
  print(appUrl.path)
} else {
  exit(1)
}`
    const r = await runCmd('swift', ['-', absPath], { stdin: swiftSrc, timeoutMs: 6000 })
    if (r.status === 0) {
      appPath = r.stdout.trim().replace(/\/$/, '')
    }
    if (appPath.endsWith('.app')) {
      const base = appPath.split('/').pop() || ''
      appName = base.replace(/\.app$/, '')
    }
  } else if (process.platform === 'win32') {
    const info = await getWindowsDefaultAppInfo(filePath)
    if (!info) return cacheNull(cacheKey)
    appPath = info.isUwp ? absPath : info.appPath
    appName = info.appName
  } else {
    const mimeRes = await runCmd('xdg-mime', ['query', 'filetype', absPath])
    const mime = mimeRes.stdout.trim()
    if (!mime) return cacheNull(cacheKey)
    const defRes = await runCmd('xdg-mime', ['query', 'default', mime])
    const desktop = defRes.stdout.trim()
    if (!desktop) return cacheNull(cacheKey)
    const { homedir } = await import('node:os')
    const candidates = [
      `${homedir()}/.local/share/applications/${desktop}`,
      `/usr/share/applications/${desktop}`,
      `/usr/local/share/applications/${desktop}`,
    ]
    const { existsSync, readFileSync } = await import('node:fs')
    const desktopPath = candidates.find((p) => existsSync(p))
    if (!desktopPath) return cacheNull(cacheKey)
    const text = readFileSync(desktopPath, 'utf8')
    const execLine = text.split('\n').find((l) => l.startsWith('Exec='))?.slice(5) || ''
    const nameLine = text.split('\n').find((l) => l.startsWith('Name='))?.slice(5) || ''
    appPath = execLine.split(/\s+/)[0] || ''
    appName = nameLine || (appPath.split('/').pop() ?? '')
  }

  if (!appPath || !appName) {
    return cacheNull(cacheKey)
  }

  const iconDataUrl = await getAppIconDataUrl(appPath).catch((e) => { console.warn('[DefaultApp] getAppIconDataUrl 失败:', e); return '' })
  if (!iconDataUrl) return cacheNull(cacheKey)

  const info: import('@proma/shared').DefaultAppInfo = { name: appName, appPath, iconDataUrl }
  defaultAppCache.set(cacheKey, info)
  return info
}

function cacheNull(key: string): null {
  defaultAppCache.set(key, null)
  return null
}

/**
 * 解析应用图标变体的文件路径
 */
export function resolveAppIconPath(variantId: string): string | null {
  const resourcesDir = getBundledResourcesDir()
  if (!variantId || variantId === 'default') {
    return join(resourcesDir, 'icon.png')
  }
  return join(resourcesDir, 'proma-logos', `proma-${variantId}.png`)
}
