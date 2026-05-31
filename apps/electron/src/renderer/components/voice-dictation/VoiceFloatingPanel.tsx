/**
 * VoiceFloatingPanel — 会话 Tab 内语音面板
 *
 * 通过 portal 渲染到 document.body。
 * 使用 ASR Provider 模式，支持 doubao / webspeech 引擎切换。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'jotai'
import { Loader2, Check } from 'lucide-react'
import type { VoiceDictationSettings } from '../../../types'
import { agentChannelIdAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, agentSessionDraftsAtom, agentSessionDraftHtmlAtom, liveMessagesMapAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import type { SDKMessage } from '@proma/shared'
import { shouldAutoSend } from './voice-auto-send'
import type { ASRProvider } from './asr-types'
import { createASRProvider } from './asr-factory'

const ACTX = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined
type Mode = 'idle' | 'recording' | 'stopping' | 'completed' | 'error'

export function VoiceFloatingPanel(): React.ReactElement {
  const store = useStore()
  const [mode, setMode] = React.useState<Mode>('idle')
  const [volume, setVolume] = React.useState(0)
  const [transcript, setTranscript] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [settings, setSettings] = React.useState<VoiceDictationSettings | null>(null)

  const mRef = React.useRef(mode); mRef.current = mode
  const trRef = React.useRef('')
  const settingsRef = React.useRef<VoiceDictationSettings | null>(null)
  const providerRef = React.useRef<ASRProvider | null>(null)
  const commitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const recStartRef = React.useRef(0)
  const silenceRef = React.useRef(0)
  const stopRecRef = React.useRef<(() => Promise<void>) | null>(null)
  const stopGuardRef = React.useRef(false)

  // ---- VAD-only AudioContext (idle mode volume bars) ----
  const vadRef = React.useRef<{
    ctx: AudioContext; proc: ScriptProcessorNode; stream: MediaStream
    ring: Int16Array; ri: number; cons: number; last: number
  } | null>(null)

  const startVAD = React.useCallback(async () => {
    if (vadRef.current) return
    if (!ACTX || !navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } },
      })
      const ctx = new ACTX()
      const src = ctx.createMediaStreamSource(stream)
      const RS = 16000 * 1.5
      const ring = new Int16Array(RS)
      let ri = 0, cons = 0, last = 0
      const proc = ctx.createScriptProcessor(2048, 1, 1)
      proc.onaudioprocess = (ev: any) => {
        if (!vadRef.current) return
        const inp = ev.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < inp.length; i++) peak = Math.max(peak, Math.abs(inp[i] ?? 0))

        // ring buffer
        for (let i = 0; i < inp.length; i++) {
          const v = Math.max(-1, Math.min(1, inp[i] ?? 0))
          ring[ri] = v < 0 ? v * 0x8000 : v * 0x7fff
          ri = (ri + 1) % RS
        }

        // 录音 VAD 静音检测
        if (mRef.current !== 'idle' && recStartRef.current > 0) {
          const now = performance.now()
          if (peak >= 0.01) { silenceRef.current = now }
          else if (silenceRef.current > 0) {
            const t = settingsRef.current?.vadStopTimeoutMs ?? 1800
            const min = settingsRef.current?.vadMinRecordMs ?? 500
            if (t > 0 && (now - silenceRef.current) >= t && (now - recStartRef.current) >= min) {
              stopRecRef.current?.().catch(() => {})
            }
          }
        }

        // VAD trigger → start ASR
        if (mRef.current === 'idle') {
          const now = performance.now()
          if (peak >= 0.03 && now - last > 3000) {
            cons++
            if (cons >= 2) {
              cons = 0; last = now
              mRef.current = 'recording'

              // save ring buffer for provider
              const copy = new Int16Array(RS)
              const older = ring.subarray(ri)
              const newer = ring.subarray(0, ri)
              copy.set(older, 0); copy.set(newer, older.length)
              ring.fill(0); ri = 0
              window.electronAPI.storeHandsfreeBuffer(copy.buffer).catch(() => {})

              setVolume(1)
              beginASR().catch(() => {})
            }
          } else { cons = 0 }
        }
        setVolume(Math.min(1, peak * 4))
      }
      src.connect(proc); proc.connect(ctx.destination)
      if (ctx.state === 'suspended') await ctx.resume()
      vadRef.current = { ctx, proc, stream, ring, ri, cons, last }
    } catch { /* noop */ }
  }, [])

  const stopVAD = React.useCallback(() => {
    const v = vadRef.current
    if (!v) return
    v.ctx.close().catch(() => {}); v.stream.getTracks().forEach(t => t.stop())
    vadRef.current = null; setVolume(0)
  }, [])

  // ---- ASR via Provider ----
  const beginASR = React.useCallback(async () => {
    committedRef.current = false
    setTranscript(''); trRef.current = ''; setMessage('')
    setMode('recording'); setMessage('正在监听...')
    recStartRef.current = performance.now()
    silenceRef.current = recStartRef.current

    let s: VoiceDictationSettings
    try { s = await window.electronAPI.getVoiceDictationSettings() } catch { setMode('error'); setMessage('无法加载设置'); return }
    settingsRef.current = s; setSettings(s)
    if (!s.enabled) { setMessage('语音输入未启用'); return }
    stopGuardRef.current = false

    const provider = createASRProvider(s.engine || 'doubao')
    providerRef.current = provider

    try {
      await provider.start({
        onTranscript: (text: string) => { setTranscript(text); trRef.current = text },
        onState: (_st: string, msg?: string) => { if (msg) setMessage(msg) },
        onVolume: (p: number) => setVolume(p),
        onEnd: (text: string) => { if (text) finishRecording(text) },
        onError: (msg: string) => { setMessage(msg) },
      })
    } catch { setMode('error'); setMessage('识别引擎启动失败') }
  }, [])

  const committedRef = React.useRef(false)

  const finishRecording = React.useCallback((text: string) => {
    if (committedRef.current) return; committedRef.current = true
    if (!text) { cleanup(); setMode('idle'); setMessage(''); return }

    setMode('stopping'); setMessage('正在输出...')
    window.electronAPI.commitVoiceDictation({ text }).then(r => {
      cleanup(); setMode('completed'); setMessage(r.message)
      // auto-send
      if (shouldAutoSend(text, settingsRef.current?.autoSendEnabled ?? true, 'always')) {
        if (store.get(appModeAtom) === 'agent') {
          const channelId = store.get(agentChannelIdAtom)
          const sessionId = store.get(currentAgentSessionIdAtom)
          const workspaceId = store.get(currentAgentWorkspaceIdAtom)
          if (sessionId && channelId) {
            store.set(agentSessionDraftsAtom, (prev) => { const m = new Map(prev); m.delete(sessionId); return m })
            store.set(agentSessionDraftHtmlAtom, (prev) => { const m = new Map(prev); m.delete(sessionId); return m })
            store.set(liveMessagesMapAtom, (prev) => {
              const m = new Map(prev); const existing = m.get(sessionId) ?? []
              m.set(sessionId, [...existing, { type: 'user', message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null, _createdAt: Date.now() } as unknown as SDKMessage])
              return m
            })
            store.set(agentStreamingStatesAtom, (prev) => {
              const m = new Map(prev); m.set(sessionId, { running: true, content: '', toolActivities: [], startedAt: Date.now() }); return m
            })
            window.electronAPI.sendAgentMessage({ sessionId, userMessage: text, channelId, workspaceId: workspaceId ?? undefined }).catch(console.error)
          }
        }
      }
    }).catch(() => { cleanup(); setMode('error'); setMessage('输出失败') })
  }, [store])

  const stopRec = React.useCallback(async () => {
    if (stopGuardRef.current) return; stopGuardRef.current = true
    setMode('stopping'); setMessage('正在收尾...')
    const p = providerRef.current
    if (p) {
      const text = await p.stop().catch(() => '')
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
      commitTimerRef.current = setTimeout(() => {
        finishRecording(text)
      }, 300)
    }
  }, [])
  stopRecRef.current = stopRec

  const cancelRec = React.useCallback(() => {
    providerRef.current?.cancel().catch(() => {})
    cleanup()
    setMode('idle'); setMessage(''); setTranscript(''); trRef.current = ''
  }, [])

  const cleanup = React.useCallback(() => {
    providerRef.current?.dispose()
    providerRef.current = null
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
  }, [])

  // ---- IPC: toggle stop (Ctrl+`) ----
  React.useEffect(() => {
    const cts = window.electronAPI.onVoiceDictationToggleStop(() => {
      if (mRef.current === 'recording') stopRecRef.current?.().catch(() => {})
    })
    return () => { cts(); cleanup(); stopVAD() }
  }, [cleanup, stopVAD, stopRec])

  // ---- settings ----
  React.useEffect(() => {
    window.electronAPI.getVoiceDictationSettings().then(s => { setSettings(s) }).catch(() => {})
  }, [])

  React.useEffect(() => {
    const h = () => window.electronAPI.getVoiceDictationSettings().then(s => { setSettings(s) }).catch(() => {})
    window.addEventListener('proma:voice-settings-changed', h); return () => window.removeEventListener('proma:voice-settings-changed', h)
  }, [])

  // ---- VAD lifecycle ----
  React.useEffect(() => {
    if (settings?.handsfreeEnabled && mode === 'idle') { startVAD().catch(() => {}) }
    else if (!settings?.handsfreeEnabled) { stopVAD() }
  }, [settings?.handsfreeEnabled, mode, startVAD, stopVAD])

  // ---- auto-retract ----
  React.useEffect(() => {
    if (mode === 'completed' || mode === 'error') {
      const t = setTimeout(() => { setTranscript(''); trRef.current = ''; setMode('idle'); setMessage('') }, 2000)
      return () => clearTimeout(t)
    }
  }, [mode])

  const hasAudio = volume > 0.02
  const isIdle = mode === 'idle'
  const enabled = settings?.handsfreeEnabled ?? false

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[9999]">
      <div className={isIdle ? '' : 'hidden'}>
        <div className="flex items-center justify-center rounded-xl border px-2.5 py-2 shadow-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700">
          <div className="flex items-end gap-[3px] h-[14px]">
            {[0.4, 0.7, 0.5, 0.9, 0.6].map((s, i) => (
              <span key={i}
                className={`w-[3px] rounded-full transition-all duration-75 ${enabled ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                style={{ height: `${Math.max(3, Math.round(hasAudio && enabled ? volume * s * 14 : s * 14))}px`, opacity: enabled ? (hasAudio ? 0.9 : 0.4) : 0.25 }} />
            ))}
          </div>
        </div>
      </div>

      <div className={isIdle ? 'hidden' : ''}>
        <div className={`drop-shadow-2xl w-[340px] min-h-[100px] rounded-xl border-2 bg-white dark:bg-zinc-900 ${mode === 'error' ? 'border-red-400 dark:border-red-600' : mode === 'completed' ? 'border-green-400 dark:border-green-600' : 'border-zinc-200 dark:border-zinc-700'}`}>
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className={`flex size-[28px] shrink-0 items-center justify-center rounded-lg ${mode === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : mode === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}>
                {mode === 'stopping' ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} /> :
                 mode === 'completed' ? <Check className="size-3.5" strokeWidth={1.5} /> :
                 <div className="flex items-end gap-[2px] h-3">
                   {[0.5, 1, 0.7, 0.9, 0.4].map((s, i) => (<span key={i} className="w-[3px] rounded-full bg-current" style={{ height: `${Math.max(3, Math.round(volume * s * 15))}px` }} />))}
                 </div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {mode === 'recording' ? `录音中` : message || (mode === 'stopping' ? '处理中' : '完成')}
                  </p>
                  {mode === 'recording' && <div className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-red-500 animate-pulse" /><span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase">REC</span></div>}
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{mode === 'recording' ? (message || '聆听中...') : ''}</p>
              </div>
            </div>
          </div>
          <div className="mx-4 h-px bg-zinc-100 dark:bg-zinc-800" />
          <div className="px-4 py-3">
            <p className={`text-sm leading-6 whitespace-pre-wrap break-words ${transcript ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-300 dark:text-zinc-600 italic'}`}>
              {transcript || 'Waiting for speech...'}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
