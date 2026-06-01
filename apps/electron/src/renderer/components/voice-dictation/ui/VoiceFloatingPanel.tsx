/**
 * VoiceFloatingPanel — 语音听写浮动面板 UI
 *
 * 纯状态观察者模式：
 *   1. 创建 Orchestrator 实例
 *   2. 注入 onAutoSend 回调（转写文本 → Agent 会话）
 *   3. 订阅 UIState 变更 → setState 驱动渲染
 *   4. 监听语音设置变更事件、IPC 快捷键停止事件
 *
 * 渲染方式：React Portal 到 document.body，z-index 9999，始终浮动。
 *
 * 三种视觉状态：
 *   - listening: 紧凑音量条（绿色脉冲指示）
 *   - recording: 340px 卡片，含图标 + 转录文本 + REC 指示灯 + 音量条
 *   - processing / completed / error: 卡片式结果展示
 *
 * @see ../core/Orchestrator.ts - 状态管理和自动发送回调
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'jotai'
import { Loader2, Check, Brain, Activity } from 'lucide-react'
import { Orchestrator } from '../core/Orchestrator'
import type { VoiceUIState } from '../types/panel'
import { agentChannelIdAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, agentSessionDraftsAtom, agentSessionDraftHtmlAtom, liveMessagesMapAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { shouldAutoSend } from '../utils/auto-send'
import type { SDKMessage } from '@proma/shared'
import { AgentStateMonitor } from '../core/AgentStateMonitor'
import type { AgentContext } from '../types/intelligence'

export function VoiceFloatingPanel(): React.ReactElement {
  const store = useStore()
  const orchRef = React.useRef<Orchestrator | null>(null)
  const agentMonitorRef = React.useRef<AgentStateMonitor | null>(null)
  /** UI 状态（由 Orchestrator 的 emit 驱动更新） */
  const [ui, setUI] = React.useState<VoiceUIState>({
    state: 'stopped', volume: 0, transcript: '', message: '', settings: null,
  })
  /** 智能决策信息 */
  const [intelligentInfo, setIntelligentInfo] = React.useState<{
    isActive: boolean
    agentState: string
    decision: string
    reasoning: string
    confidence: number
  }>({
    isActive: false,
    agentState: 'unknown',
    decision: 'unknown',
    reasoning: '',
    confidence: 0
  })

  /**
   * 初始化 Orchestrator 和 Agent 状态监听器
   *
   * 执行顺序：
   *   1. 创建 Orchestrator + AgentStateMonitor
   *   2. 注入 onAutoSend（转写文本 → 清除代理草稿 → 构造 user 消息 → 发送到 Agent 会话）
   *   3. 订阅 UIState 变更 → setUI
   *   4. 加载语音设置并切换免提
   *   5. 集成 Agent 状态监听器 → 智能决策
   *   6. 监听 proma:voice-settings-changed 事件（设置页变更时动态切换）
   *   7. 监听 onVoiceDictationToggleStop（快捷键停止录音）
   *   8. 清理：取消订阅 → 销毁所有组件
   */
  React.useEffect(() => {
    const orch = new Orchestrator()
    orchRef.current = orch

    // 🎯 创建 Agent 状态监听器
    const agentMonitor = new AgentStateMonitor()
    agentMonitorRef.current = agentMonitor

    console.log('[VoiceFloatingPanel] 初始化智能语音识别系统')

    // 注入自动发送回调：转写文本 → 当前 Agent 会话
    orch.onAutoSend = (text: string) => {
      if (store.get(appModeAtom) !== 'agent') return
      const channelId = store.get(agentChannelIdAtom)
      const sessionId = store.get(currentAgentSessionIdAtom)
      const workspaceId = store.get(currentAgentWorkspaceIdAtom)

      // 🎯 设置当前Agent会话ID到Orchestrator，用于即时指令打断
      orch.setCurrentAgentSessionId(sessionId)

      if (!sessionId || !channelId) return

      // 🎯 智能决策已经在Orchestrator中处理，这里直接发送
      // Orchestrator.makeIntelligentDecision会判断是否应该发送

      // 清除草稿
      store.set(agentSessionDraftsAtom, (prev) => { const m = new Map(prev); m.delete(sessionId); return m })
      store.set(agentSessionDraftHtmlAtom, (prev) => { const m = new Map(prev); m.delete(sessionId); return m })
      // 构造 user 消息并追加到消息列表
      store.set(liveMessagesMapAtom, (prev) => {
        const m = new Map(prev); const existing = m.get(sessionId) ?? []
        m.set(sessionId, [...existing, { type: 'user', message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null, _createdAt: Date.now() } as unknown as SDKMessage])
        return m
      })
      // 标记流式状态为 running
      store.set(agentStreamingStatesAtom, (prev) => {
        const m = new Map(prev); m.set(sessionId, { running: true, content: '', toolActivities: [], startedAt: Date.now() }); return m
      })
      // 通过 IPC 发送消息
      window.electronAPI.sendAgentMessage({ sessionId, userMessage: text, channelId, workspaceId: workspaceId ?? undefined }).catch(console.error)
    }

    // 订阅 UI 状态变更
    const unsub = orch.onUIState((s) => setUI({ ...s }))

    // 加载语音设置并初始化
    window.electronAPI.getVoiceDictationSettings().then(s => {
      orch.toggleHandsfree(s).catch(() => {})
    }).catch(() => {})

    // 🎯 集成 Agent 状态监听器
    const monitorAgentState = () => {
      try {
        const streamingState = store.get(agentStreamingStatesAtom)
        const sessionId = store.get(currentAgentSessionIdAtom)
        const appMode = store.get(appModeAtom)

        if (sessionId && streamingState && appMode === 'agent') {
          // 获取当前会话的状态
          const currentSessionState = streamingState.get(sessionId)

          if (currentSessionState) {
            // 🎯 同步sessionId到Orchestrator，用于即时指令打断
            orch.setCurrentAgentSessionId(sessionId)

            // 更新 Agent 状态监听器
            agentMonitor.updateAgentState?.({
              mode: 'agent',
              status: currentSessionState.running ? 'processing' : 'idle',
              streamingState: {
                running: currentSessionState.running,
                content: currentSessionState.content || '',
                toolActivities: currentSessionState.toolActivities?.map(t => t.toolName) || []
              },
              hasError: false, // AgentStreamState中没有错误字段，暂时设为false
              recentMessages: [],
              lastUserMessageTime: Date.now()
            })

            // 获取当前 Agent 上下文
            const agentContext = agentMonitor.getCurrentContext?.()
            if (agentContext) {
              // 更新智能决策信息显示
              setIntelligentInfo({
                isActive: true,
                agentState: agentContext.loopState,
                decision: agentContext.canAcceptInput ? '可接受输入' : '等待空闲',
                reasoning: `Agent状态: ${agentContext.loopState}, 工具活动: ${agentContext.activeToolCalls.length}个`,
                confidence: agentContext.canAcceptInput ? 0.9 : 0.6
              })
            }
          } else {
            // 会话存在但没有状态数据
            setIntelligentInfo({
              isActive: true,
              agentState: 'unknown',
              decision: '初始化中',
              reasoning: '会话正在初始化',
              confidence: 0.3
            })
          }
        } else {
          // 非 Agent 模式或无活跃会话
          setIntelligentInfo({
            isActive: false,
            agentState: 'unknown',
            decision: 'unknown',
            reasoning: '非Agent模式或无活跃会话',
            confidence: 0
          })
        }
      } catch (error) {
        console.error('[VoiceFloatingPanel] Agent状态监听错误:', error)
      }
    }

    // 监听 Agent 状态变化
    const unsubscribeAtom = store.sub(agentStreamingStatesAtom, () => {
      monitorAgentState()
    })

    // 监听应用模式变化
    const unsubscribeMode = store.sub(appModeAtom, () => {
      monitorAgentState()
    })

    // 初始调用
    monitorAgentState()

    // 监听设置变更事件（设置页修改时同步）
    const handler = () => {
      window.electronAPI.getVoiceDictationSettings().then(s => {
        orch.toggleHandsfree(s).catch(() => {})
      }).catch(() => {})
    }
    window.addEventListener('proma:voice-settings-changed', handler)

    // 监听 IPC 停止录音通知（快捷键）
    const cts = window.electronAPI.onVoiceDictationToggleStop(() => {
      orch.stopRecording().catch(() => {})
    })

    return () => {
      unsub()
      unsubscribeAtom?.()
      unsubscribeMode?.()
      window.removeEventListener('proma:voice-settings-changed', handler)
      cts()
      orch.destroy()
      agentMonitor.dispose?.()
    }
  }, [store])

  const { state, volume, transcript, message, settings } = ui
  const enabled = settings?.handsfreeEnabled ?? false
  const hasAudio = volume > 0.02
  const showIntelligentInfo = intelligentInfo.isActive && (state === 'recording' || state === 'listening')

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
                {/* 🎯 智能决策信息显示 */}
                {showIntelligentInfo && (
                  <div className="flex items-center gap-1 mt-1">
                    <Brain className="size-3 text-purple-500" />
                    <p className="text-xs text-purple-400 dark:text-purple-500">
                      {intelligentInfo.agentState}
                    </p>
                  </div>
                )}
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
