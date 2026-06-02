/**
 * VoiceFloatingPanel — 语音听写浮动面板 UI
 *
 * 纯状态观察者模式：
 *   1. 创建 Orchestrator 实例
 *   2. 订阅 UIState 变更 → setState 驱动渲染
 *   3. 桥接 Agent 上下文到 Orchestrator（不在 UI 做业务决策）
 *   4. 监听语音设置变更事件、IPC 快捷键停止事件
 *
 * 渲染方式：React Portal 到 document.body，z-index 9999，始终浮动。
 *
 * 三种视觉状态：
 *   - listening: 紧凑音量条（绿色脉冲指示）
 *   - recording: 340px 卡片，含图标 + 转录文本 + REC 指示灯 + 音量条
 *   - processing / completed / error: 卡片式结果展示
 *
 * @see ../core/orchestrator/Orchestrator.ts - 状态管理和自动发送回调
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'jotai'
import { Loader2, Check } from 'lucide-react'
import { Orchestrator } from '../core/orchestrator/Orchestrator'
import type { VoiceUIState } from '../types/panel'
import { currentAgentSessionIdAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { onVoiceSettingsChanged } from '../events'

export function VoiceFloatingPanel(): React.ReactElement {
  const store = useStore()
  /** UI 状态（由 Orchestrator 的 emit 驱动更新） */
  const [ui, setUI] = React.useState<VoiceUIState>({
    state: 'stopped', volume: 0, transcript: '', message: '', settings: null,
  })

  /**
   * 初始化 Orchestrator 并桥接状态
   *
   * 执行顺序：
   *   1. 创建 Orchestrator
   *   2. 订阅 UIState 变更 → setUI
   *   3. 加载语音设置并切换免提
   *   4. 同步 Agent 上下文到 Orchestrator（状态桥接）
   *   5. 监听 proma:voice-settings-changed 事件（设置页变更时动态切换）
   *   6. 监听 onVoiceDictationToggleStop（快捷键停止录音）
   *   7. 清理：取消订阅 → 销毁所有组件
   */
  React.useEffect(() => {
    const orch = new Orchestrator()

    // 订阅 UI 状态变更
    const unsub = orch.onUIState((s) => setUI({ ...s }))

    // 加载语音设置并初始化
    window.electronAPI.getVoiceDictationSettings().then(s => {
      orch.toggleHandsfree(s).catch(() => {})
    }).catch(() => {})

    // 同步 Agent 上下文到 Orchestrator（UI 仅负责桥接状态，不做决策）
    const syncAgentContext = () => {
      try {
        const streamingStates = store.get(agentStreamingStatesAtom)
        const sessionId = store.get(currentAgentSessionIdAtom)
        const mode = store.get(appModeAtom)
        const activeState = sessionId ? streamingStates.get(sessionId) : undefined
        const normalizedMode = mode === 'agent' ? 'agent' : 'chat'

        orch.setCurrentAgentSessionId(mode === 'agent' ? (sessionId ?? null) : null)
        orch.updateAgentState({
          mode: normalizedMode,
          status: activeState?.running ? 'processing' : 'idle',
          streamingState: {
            running: activeState?.running ?? false,
            content: activeState?.content ?? '',
            toolActivities: activeState?.toolActivities?.map((activity) => activity.toolName) ?? [],
          },
          hasError: false,
          recentMessages: [],
          lastUserMessageTime: Date.now(),
        })
      } catch (error) {
        console.error('[VoiceFloatingPanel] 同步Agent上下文失败:', error)
      }
    }

    const unsubscribeStreaming = store.sub(agentStreamingStatesAtom, syncAgentContext)
    const unsubscribeSession = store.sub(currentAgentSessionIdAtom, syncAgentContext)
    const unsubscribeMode = store.sub(appModeAtom, syncAgentContext)
    syncAgentContext()

    // 监听设置变更事件（设置页修改时同步）
    const handler = () => {
      window.electronAPI.getVoiceDictationSettings().then(s => {
        orch.toggleHandsfree(s).catch(() => {})
      }).catch(() => {})
    }
    const unsubscribeSettingsChanged = onVoiceSettingsChanged(handler)

    // 监听 IPC 停止录音通知（快捷键）
    const cts = window.electronAPI.onVoiceDictationToggleStop(() => {
      orch.stopRecording().catch(() => {})
    })

    return () => {
      unsub()
      unsubscribeStreaming?.()
      unsubscribeSession?.()
      unsubscribeMode?.()
      unsubscribeSettingsChanged()
      cts()
      orch.destroy()
    }
  }, [store])

  const { state, volume, transcript, message, settings } = ui
  const enabled = settings?.handsfreeEnabled ?? false
  const hasAudio = volume > 0.02

  const panel = (
    <div className="fixed bottom-4 right-4 z-[9999]">
      {/* listening 状态：紧凑的绿色音量条 */}
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

      {/* recording / processing / completed / error 状态：详细卡片 */}
      {!['stopped', 'listening'].includes(state) && (
        <div className={`drop-shadow-2xl w-[340px] min-h-[100px] rounded-xl border-2 bg-white dark:bg-zinc-900 ${
          state === 'error' ? 'border-red-400 dark:border-red-600' :
          state === 'processing' || state === 'completed' ? 'border-green-400 dark:border-green-600' :
          'border-zinc-200 dark:border-zinc-700'
        }`}>
          <div className="p-4">
            <div className="flex items-start gap-3">
              {/* 左侧图标 */}
              <div className={`flex size-[28px] shrink-0 items-center justify-center rounded-lg ${
                state === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                state === 'processing' || state === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              }`}>
                {state === 'processing' ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} /> :
                 state === 'completed' ? <Check className="size-3.5" strokeWidth={1.5} /> :
                 <VolumeBars peak={volume} />}
              </div>
              {/* 右侧状态信息 */}
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
          {/* 转录文本展示 */}
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

/**
 * 音量条组件 — 5 条动态高度竖条展示实时音量
 *
 * 每个条的高度 = peak × 预设系数 × 15px，最低 3px
 */
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
