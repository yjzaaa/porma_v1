/**
 * VoiceFloatingPanel — 会话 Tab 内语音面板
 * 通过 portal 渲染到 document.body，避开所有祖先 stacking context。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'jotai'
import { Loader2, Check } from 'lucide-react'
import { CHUNK_BYTES, concatAudioBuffers, floatTo16BitPcm, splitChunk } from './voice-audio-utils'
import type { VoiceDictationCommitResult, VoiceDictationSettings, VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../types'
import { agentChannelIdAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, agentSessionDraftsAtom, agentSessionDraftHtmlAtom, liveMessagesMapAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import type { SDKMessage } from '@proma/shared'

import { shouldAutoSend } from './voice-auto-send'

const ACTX = (window as any).AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext | undefined
type Mode = 'idle' | 'recording' | 'stopping' | 'completed' | 'error'

export function VoiceFloatingPanel(): React.ReactElement {
  const store = useStore()
  const [mode, setMode] = React.useState<Mode>('idle')
  const [volume, setVolume] = React.useState(0)
  const [transcript, setTranscript] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [cr, setCr] = React.useState<VoiceDictationCommitResult | null>(null)
  const [enabled, setEnabled] = React.useState(false)

  const mRef = React.useRef(mode); mRef.current = mode
  const eRef = React.useRef(enabled); eRef.current = enabled
  const sidRef = React.useRef<string | null>(null)
  const trRef = React.useRef('')
  const bufRef = React.useRef<ArrayBuffer[]>([])
  const asrRef = React.useRef(false)
  const stopRef = React.useRef(false)
  const commitRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const silRef = React.useRef(-1)
  const recStartRef = React.useRef(0)
  const setRef = React.useRef<VoiceDictationSettings | null>(null)

  // single getUserMedia
  const capRef = React.useRef<{ s: MediaStream; c: AudioContext; r: Int16Array; ri: number; cons: number; last: number } | null>(null)

  const ensureCap = React.useCallback(async () => {
    if (capRef.current) return true
    if (!ACTX || !navigator.mediaDevices?.getUserMedia) return false
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } } })
      const c = new ACTX(); const src = c.createMediaStreamSource(s)
      const RS = 16000 * 1.5
      const cap = { s, c, r: new Int16Array(RS), ri: 0, cons: 0, last: 0 }
      capRef.current = cap
      const p = c.createScriptProcessor(2048, 1, 1)
      p.onaudioprocess = (ev: any) => {
        if (!capRef.current) return
        const inp = ev.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < inp.length; i++) peak = Math.max(peak, Math.abs(inp[i] ?? 0))
        for (let i = 0; i < inp.length; i++) { const v = Math.max(-1, Math.min(1, inp[i] ?? 0)); cap.r[cap.ri] = v < 0 ? v * 0x8000 : v * 0x7fff; cap.ri = (cap.ri + 1) % RS }

        // VAD (idle only)
        if (mRef.current === 'idle' && eRef.current) {
          const n = performance.now()
          if (peak >= 0.03 && n - cap.last > 3000) {
            cap.cons++
            if (cap.cons >= 2) {
              cap.cons = 0; cap.last = n
              mRef.current = 'recording'
              const cp = new Int16Array(RS); const o = cap.r.subarray(cap.ri); const nw = cap.r.subarray(0, cap.ri)
              cp.set(o, 0); cp.set(nw, o.length); cap.r.fill(0); cap.ri = 0
              window.electronAPI.storeHandsfreeBuffer(cp.buffer).catch(() => {})
              setVolume(1)
              startRec().catch(() => {})
            }
          } else { cap.cons = 0 }
        }

        // ASR forwarding
        if (sidRef.current && asrRef.current && !stopRef.current) {
          const n = Date.now()
          if (peak >= 0.01) { silRef.current = n }
          else if (silRef.current > 0) {
            const st = setRef.current; const t = st?.vadStopTimeoutMs ?? 1800; const m = st?.vadMinRecordMs ?? 500
            if (t > 0 && n - silRef.current >= t && n - recStartRef.current >= m) { stopRec().catch(() => {}) }
          }
          const pcm = floatTo16BitPcm(inp, c.sampleRate)
          bufRef.current.push(pcm)
          let merg = concatAudioBuffers(bufRef.current)
          const nx: ArrayBuffer[] = []
          while (merg.byteLength >= CHUNK_BYTES) { const { chunk, rest } = splitChunk(merg, CHUNK_BYTES); if (!chunk) break; window.electronAPI.sendVoiceDictationAudio({ sessionId: sidRef.current!, data: chunk }).catch(() => {}); merg = rest }
          if (merg.byteLength > 0) nx.push(merg)
          bufRef.current = nx
        }
        setVolume(Math.min(1, peak * 4))
      }
      src.connect(p); p.connect(c.destination)
      if (c.state === 'suspended') await c.resume()
      return true
    } catch { return false }
  }, [])

  const stopCap = React.useCallback(() => {
    const cap = capRef.current
    if (!cap) return
    cap.c.close().catch(() => {}); cap.s.getTracks().forEach(t => t.stop())
    capRef.current = null; setVolume(0)
  }, [])

  const startRec = React.useCallback(async () => {
    stopRef.current = false; silRef.current = Date.now(); recStartRef.current = Date.now()
    asrRef.current = false; bufRef.current = []
    setTranscript(''); trRef.current = ''; setCr(null)
    setMode('recording'); setMessage('正在监听...')
    window.electronAPI.getVoiceDictationSettings().then(s => {
      setRef.current = s
      if (!s.enabled) { setMessage('语音输入未启用'); return }
      window.electronAPI.checkMicrophonePermission().then(p => {
        if (p.status === 'denied') { setMessage('麦克风被阻止'); return }
        const sid = crypto.randomUUID(); sidRef.current = sid
        window.electronAPI.getHandsfreeBuffer().then(buf => {
          if (buf && buf.byteLength > 0 && sidRef.current === sid) {
            const CH = 6400; let off = 0
            while (off < buf.byteLength) { const end = Math.min(off + CH, buf.byteLength); window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: buf.slice(off, end) }).catch(() => {}); off = end }
          }
        }).catch(() => {})
        setMessage('连接 ASR...')
        window.electronAPI.startVoiceDictation({ sessionId: sid }).then(() => { if (sidRef.current === sid) { asrRef.current = true; setMessage('正在听写') } }).catch(() => { setMessage('ASR 连接失败') })
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  const flushQ = React.useCallback(() => {
    const sid = sidRef.current; if (!sid) return
    const cs = bufRef.current; bufRef.current = []
    for (const c of cs) window.electronAPI.sendVoiceDictationAudio({ sessionId: sid, data: c }).catch(() => {})
  }, [])

  /** 自动发送语音文本到 Agent 会话 */
  const tryAutoSend = React.useCallback((text: string) => {
    if (!shouldAutoSend(text, setRef.current?.autoSendEnabled ?? true, 'always')) return
    if (store.get(appModeAtom) !== 'agent') return
    const channelId = store.get(agentChannelIdAtom)
    const sessionId = store.get(currentAgentSessionIdAtom)
    const workspaceId = store.get(currentAgentWorkspaceIdAtom)
    if (!sessionId || !channelId) return

    // 清除草稿，乐观插入用户消息
    store.set(agentSessionDraftsAtom, (prev) => { const m = new Map(prev); m.delete(sessionId); return m })
    store.set(agentSessionDraftHtmlAtom, (prev) => { const m = new Map(prev); m.delete(sessionId); return m })
    store.set(liveMessagesMapAtom, (prev) => {
      const m = new Map(prev)
      const existing = m.get(sessionId) ?? []
      m.set(sessionId, [...existing, {
        type: 'user',
        message: { content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as SDKMessage])
      return m
    })
    store.set(agentStreamingStatesAtom, (prev) => {
      const m = new Map(prev)
      m.set(sessionId, { running: true, content: '', toolActivities: [], startedAt: Date.now() })
      return m
    })
    window.electronAPI.sendAgentMessage({
      sessionId, userMessage: text, channelId,
      workspaceId: workspaceId ?? undefined,
    }).catch(console.error)
  }, [store])

  const stopRec = React.useCallback(async () => {
    if (stopRef.current) return; stopRef.current = true
    const sid = sidRef.current; setMode('stopping'); setMessage('正在收尾...')
    flushQ()
    if (sid && asrRef.current) { await window.electronAPI.stopVoiceDictation({ sessionId: sid }).catch(() => {}) }
    if (commitRef.current) clearTimeout(commitRef.current)
    commitRef.current = setTimeout(() => {
      const text = trRef.current.trim()
      if (!text) { cleanup(); setMode('idle'); setMessage(''); return }
      setMode('stopping'); setMessage('正在输出...')
      window.electronAPI.commitVoiceDictation({ text }).then(r => {
        setMode('completed'); setMessage(r.message); setCr(r); cleanup()
        tryAutoSend(text)
      }).catch(() => { cleanup(); setMode('error'); setMessage('输出失败') })
    }, 1400)
  }, [flushQ, tryAutoSend])

  const cleanup = React.useCallback(() => {
    if (sidRef.current) { window.electronAPI.cancelVoiceDictation({ sessionId: sidRef.current }).catch(() => {}); sidRef.current = null }
    asrRef.current = false; bufRef.current = []
    if (commitRef.current) { clearTimeout(commitRef.current); commitRef.current = null }
  }, [])

  // IPC
  React.useEffect(() => {
    const ct = window.electronAPI.onVoiceDictationTranscript((e: VoiceDictationTranscriptEvent) => {
      if (e.sessionId !== sidRef.current) return
      const t = e.text.trim(); if (!t) return
      setTranscript(t); trRef.current = t
    })
    const cs = window.electronAPI.onVoiceDictationState((e: VoiceDictationStateEvent) => { if (e.message) setMessage(e.message) })
    const cts = window.electronAPI.onVoiceDictationToggleStop(() => { stopRec().catch(() => {}) })
    return () => { ct(); cs(); cts(); cleanup(); stopCap() }
  }, [cleanup, stopCap, stopRec])

  // settings
  React.useEffect(() => { window.electronAPI.getVoiceDictationSettings().then(s => setEnabled(s.handsfreeEnabled)).catch(() => {}) }, [])
  React.useEffect(() => {
    const h = () => window.electronAPI.getVoiceDictationSettings().then(s => setEnabled(s.handsfreeEnabled)).catch(() => {})
    window.addEventListener('proma:voice-settings-changed', h); return () => window.removeEventListener('proma:voice-settings-changed', h)
  }, [])

  // capture lifecycle
  React.useEffect(() => { if (enabled && mode === 'idle') ensureCap().catch(() => {}); else if (!enabled) stopCap() }, [enabled, mode, ensureCap, stopCap])

  // auto-retract
  React.useEffect(() => {
    if (mode === 'completed' || mode === 'error') {
      const t = setTimeout(() => { setTranscript(''); trRef.current = ''; setMode('idle'); setMessage('') }, 2000)
      return () => clearTimeout(t)
    }
  }, [mode])

  const hasAudio = volume > 0.02
  const isIdle = mode === 'idle'

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[9999]">
      {/* 音量柱 (idle 才可见) */}
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

      {/* 卡片 (非 idle 才可见) */}
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
                    {mode === 'stopping' ? 'Processing' : mode === 'completed' ? 'Done' : 'Recording'}
                  </p>
                  {mode === 'recording' && <div className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-red-500 animate-pulse" /><span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase">REC</span></div>}
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{message || 'Listening...'}</p>
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
