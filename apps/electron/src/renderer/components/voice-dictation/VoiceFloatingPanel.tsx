/**
 * VoiceFloatingPanel — 语音面板 UI
 *
 * 纯状态观察者：创建 Orchestrator → 注入 auto-send 回调 → 订阅 UIState → 渲染。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'jotai'
import { Loader2, Check } from 'lucide-react'
import { Orchestrator } from './arch/Orchestrator'
import type { VoiceUIState } from './arch/types'
import { agentChannelIdAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, agentSessionDraftsAtom, agentSessionDraftHtmlAtom, liveMessagesMapAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { shouldAutoSend } from './voice-auto-send'
import type { SDKMessage } from '@proma/shared'

export function VoiceFloatingPanel(): React.ReactElement {
  const store = useStore()
  const orchRef = React.useRef<Orchestrator | null>(null)
  const [ui, setUI] = React.useState<VoiceUIState>({
    state: 'stopped', volume: 0, transcript: '', message: '', settings: null,
  })

  React.useEffect(() => {
    const orch = new Orchestrator()
    orchRef.current = orch

    // 注入 auto-send 回调
    orch.onAutoSend = (text: string) => {
      if (!shouldAutoSend(text, ui.settings?.autoSendEnabled ?? true, 'always')) return
      if (store.get(appModeAtom) !== 'agent') return
      const channelId = store.get(agentChannelIdAtom)
      const sessionId = store.get(currentAgentSessionIdAtom)
      const workspaceId = store.get(currentAgentWorkspaceIdAtom)
      if (!sessionId || !channelId) return

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

    const unsub = orch.onUIState((s) => setUI({ ...s }))

    window.electronAPI.getVoiceDictationSettings().then(s => {
      orch.toggleHandsfree(s).catch(() => {})
    }).catch(() => {})

    const handler = () => {
      window.electronAPI.getVoiceDictationSettings().then(s => {
        orch.toggleHandsfree(s).catch(() => {})
      }).catch(() => {})
    }
    window.addEventListener('proma:voice-settings-changed', handler)

    const cts = window.electronAPI.onVoiceDictationToggleStop(() => {
      orch.stopRecording().catch(() => {})
    })

    return () => {
      unsub()
      window.removeEventListener('proma:voice-settings-changed', handler)
      cts()
      orch.destroy()
    }
  }, [store])

  const { state, volume, transcript, message, settings } = ui
  const enabled = settings?.handsfreeEnabled ?? false
  const hasAudio = volume > 0.02

  const panel = (
    <div className="fixed bottom-4 right-4 z-[9999]">
      {state === 'listening' && (
        <div className="flex items-center justify-center rounded-xl border px-2.5 py-2 shadow-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700">
          <div className="flex items-end gap-[3px] h-[14px]">
            {[0.4, 0.7, 0.5, 0.9, 0.6].map((s, i) => (
              <span key={i}
                className={`w-[3px] rounded-full transition-all duration-75 ${enabled ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                style={{
                  height: `${Math.max(3, Math.round(hasAudio && enabled ? volume * s * 14 : s * 14))}px`,
                  opacity: enabled ? (hasAudio ? 0.9 : 0.4) : 0.25,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!['stopped', 'listening'].includes(state) && (
        <div className={`drop-shadow-2xl w-[340px] min-h-[100px] rounded-xl border-2 bg-white dark:bg-zinc-900 ${
          state === 'error' ? 'border-red-400 dark:border-red-600' :
          state === 'processing' || state === 'completed' ? 'border-green-400 dark:border-green-600' :
          'border-zinc-200 dark:border-zinc-700'
        }`}>
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className={`flex size-[28px] shrink-0 items-center justify-center rounded-lg ${
                state === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                state === 'processing' || state === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              }`}>
                {state === 'processing' ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} /> :
                 state === 'completed' ? <Check className="size-3.5" strokeWidth={1.5} /> :
                 <VolumeBars peak={volume} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {state === 'recording' ? '录音中' : message || (state === 'processing' ? '处理中' : '完成')}
                  </p>
                  {state === 'recording' && (
                    <div className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase">REC</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                  {state === 'recording' ? (message || '聆听中...') : ''}
                </p>
              </div>
            </div>
          </div>
          <div className="mx-4 h-px bg-zinc-100 dark:bg-zinc-800" />
          <div className="px-4 py-3">
            <p className={`text-sm leading-6 whitespace-pre-wrap break-words ${transcript ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-300 dark:text-zinc-600 italic'}`}>
              {transcript || '等待语音...'}
            </p>
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(panel, document.body)
}

function VolumeBars({ peak }: { peak: number }): React.ReactElement {
  return (
    <div className="flex items-end gap-[2px] h-3">
      {[0.5, 1, 0.7, 0.9, 0.4].map((s, i) => (
        <span key={i} className="w-[3px] rounded-full bg-current"
          style={{ height: `${Math.max(3, Math.round(peak * s * 15))}px` }} />
      ))}
    </div>
  )
}
