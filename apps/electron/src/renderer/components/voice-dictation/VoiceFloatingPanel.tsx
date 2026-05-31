/**
 * VoiceFloatingPanel — 语音面板 UI（纯状态观察者）
 *
 * 所有业务逻辑在 arch/Orchestrator 中。
 * 本组件只负责：创建 Orchestrator → 订阅 UIState → 渲染。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Check } from 'lucide-react'
import { Orchestrator } from './arch/Orchestrator'
import type { VoiceUIState, PanelState } from './arch/types'

export function VoiceFloatingPanel(): React.ReactElement {
  const orchRef = React.useRef<Orchestrator | null>(null)
  const [ui, setUI] = React.useState<VoiceUIState>({
    state: 'stopped', volume: 0, transcript: '', message: '', settings: null,
  })

  // 初始化
  React.useEffect(() => {
    const orch = new Orchestrator()
    orchRef.current = orch

    const unsub = orch.onUIState((s) => setUI({ ...s }))

    // 读取初始设置
    window.electronAPI.getVoiceDictationSettings().then(s => {
      orch.toggleHandsfree(s).catch(() => {})
    }).catch(() => {})

    // 监听设置变更
    const handler = () => {
      window.electronAPI.getVoiceDictationSettings().then(s => {
        orch.toggleHandsfree(s).catch(() => {})
      }).catch(() => {})
    }
    window.addEventListener('proma:voice-settings-changed', handler)

    // 监听快捷键停止
    const cts = window.electronAPI.onVoiceDictationToggleStop(() => {
      orch.stopRecording().catch(() => {})
    })

    return () => {
      unsub()
      window.removeEventListener('proma:voice-settings-changed', handler)
      cts()
      orch.destroy()
    }
  }, [])

  const { state, volume, transcript, message, settings } = ui
  const enabled = settings?.handsfreeEnabled ?? false
  const hasAudio = volume > 0.02

  const panel = (
    <div className="fixed bottom-4 right-4 z-[9999]">
      {/* 音量柱（stopped/listening 模式可见） */}
      {(state === 'listening') && (
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

      {/* 卡片（recording/processing/completed/error） */}
      {!['stopped', 'listening'].includes(state) && (
        <div className={`drop-shadow-2xl w-[340px] min-h-[100px] rounded-xl border-2 bg-white dark:bg-zinc-900 ${
          state === 'error' ? 'border-red-400 dark:border-red-600' :
          state === 'completed' ? 'border-green-400 dark:border-green-600' :
          'border-zinc-200 dark:border-zinc-700'
        }`}>
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className={`flex size-[28px] shrink-0 items-center justify-center rounded-lg ${
                state === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                state === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
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
