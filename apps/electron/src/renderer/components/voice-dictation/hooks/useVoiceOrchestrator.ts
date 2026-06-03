/**
 * 【第 4 层 - 业务模块层】语音模块 Hook
 *
 * 职责：
 * - 创建和管理 Orchestrator 生命周期
 * - 桥接 Jotai Agent Atoms 到语音模块
 * - 监听设置变更和 IPC 事件
 * - 处理 ASR 对外交互（IPC 请求/事件）
 * - 提供 UI 状态订阅接口
 *
 * 使用方式：
 * ```tsx
 * function VoiceFloatingPanel() {
 *   const { ui, toggleHandsfree, stopRecording } = useVoiceOrchestrator()
 *   // 纯 UI 渲染
 * }
 * ```
 */

import * as React from 'react'
import { useStore } from 'jotai'
import { Orchestrator } from '../core/orchestrator/Orchestrator'
import { VoiceAsrTransportBus } from '../shared/bus/VoiceAsrTransportBus'
import type { VoiceAsrTransportRequest } from '../shared/bus/VoiceAsrTransportBus'
import type { VoiceDictationIpcBridge } from '../shared/types/voice-dictation-ipc'
import type { VoiceUIState } from '../shared/types/panel'
import type {
  VoiceDictationSettings,
  VoiceDictationStartInput,
  VoiceDictationAudioChunkInput,
  VoiceDictationStopInput,
} from '@/types/settings'
import { currentAgentSessionIdAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { onVoiceSettingsChanged } from '../ui-events'

export interface UseVoiceOrchestratorResult {
  /** UI 状态快照 */
  ui: VoiceUIState
  /** 切换免提模式 */
  toggleHandsfree: (settings: VoiceDictationSettings) => Promise<void>
  /** 停止录音 */
  stopRecording: () => Promise<void>
}

/**
 * 语音模块 Hook
 *
 * 封装所有与语音模块的业务逻辑，让 UI 组件只负责渲染。
 */
export function useVoiceOrchestrator(): UseVoiceOrchestratorResult {
  const store = useStore()
  const orchRef = React.useRef<Orchestrator | null>(null)
  const [ui, setUI] = React.useState<VoiceUIState>({
    state: 'stopped',
    volume: 0,
    transcript: '',
    message: '',
    settings: null,
  })

  /**
   * 初始化 Orchestrator 并桥接状态
   *
   * 执行顺序：
   *   1. 创建 transportBus 和处理 ASR 对外交互
   *   2. 创建 Orchestrator（传入 transportBus）
   *   3. 订阅 UIState 变更 → setUI
   *   4. 加载语音设置并切换免提
   *   5. 同步 Agent 上下文到 Orchestrator（状态桥接）
   *   6. 监听设置变更事件（设置页变更时动态切换）
   *   7. 监听 IPC 快捷键停止录音事件
   *   8. 清理：取消订阅 → 销毁所有组件
   */
  React.useEffect(() => {
    // === 1. 创建 ASR 对外交互总线 ===
    const transportBus = new VoiceAsrTransportBus()
    const ipcBridge: VoiceDictationIpcBridge = {
      commitVoiceDictation: (input) => window.electronAPI.commitVoiceDictation(input),
      stopAgent: (sessionId) => window.electronAPI.stopAgent(sessionId),
      writeVoiceDictationLog: (logContent) => window.electronAPI.writeVoiceDictationLog(logContent),
    }

    // === 2. 处理 ASR 传输请求 ===
    const requestTimeoutMs = {
      permission: 5000,
      start: 10000,
      audio: 8000,
      stop: 10000,
      buffer: 5000,
    } as const

    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | null = null
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`${label}超时`))
            }, timeoutMs)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    const handleTransportRequest = async (request: VoiceAsrTransportRequest): Promise<void> => {
      try {
        switch (request.type) {
          case 'checkMicrophonePermission': {
            const result = await withTimeout(
              window.electronAPI.checkMicrophonePermission(),
              requestTimeoutMs.permission,
              '检查麦克风权限',
            )
            transportBus.respond(request.id, result)
            return
          }
          case 'requestMicrophonePermission': {
            const result = await withTimeout(
              window.electronAPI.requestMicrophonePermission(),
              requestTimeoutMs.permission,
              '请求麦克风权限',
            )
            transportBus.respond(request.id, result)
            return
          }
          case 'startVoiceDictation': {
            await withTimeout(
              window.electronAPI.startVoiceDictation(request.payload as VoiceDictationStartInput),
              requestTimeoutMs.start,
              '启动语音识别',
            )
            transportBus.respond(request.id, undefined)
            return
          }
          case 'sendVoiceDictationAudio': {
            await withTimeout(
              window.electronAPI.sendVoiceDictationAudio(request.payload as VoiceDictationAudioChunkInput),
              requestTimeoutMs.audio,
              '发送语音分片',
            )
            transportBus.respond(request.id, undefined)
            return
          }
          case 'stopVoiceDictation': {
            await withTimeout(
              window.electronAPI.stopVoiceDictation(request.payload as VoiceDictationStopInput),
              requestTimeoutMs.stop,
              '停止语音识别',
            )
            transportBus.respond(request.id, undefined)
            return
          }
          case 'cancelVoiceDictation': {
            await withTimeout(
              window.electronAPI.cancelVoiceDictation(request.payload as VoiceDictationStopInput),
              requestTimeoutMs.stop,
              '取消语音识别',
            )
            transportBus.respond(request.id, undefined)
            return
          }
          case 'getHandsfreeBuffer': {
            const buffer = await withTimeout(
              window.electronAPI.getHandsfreeBuffer(),
              requestTimeoutMs.buffer,
              '获取免提缓冲',
            )
            transportBus.respond(request.id, buffer)
            return
          }
        }
      } catch (error) {
        console.error('[useVoiceOrchestrator] ASR 请求失败', request.type, error)
        transportBus.reject(request.id, error)
      }
    }

    // === 3. 监听传输请求 ===
    const unsubRequest = transportBus.onRequest(handleTransportRequest)

    // === 4. 监听主进程回传事件 ===
    const unsubTranscript = window.electronAPI.onVoiceDictationTranscript((event) => {
      transportBus.emitEvent('transcript', event)
    })

    const unsubState = window.electronAPI.onVoiceDictationState((event) => {
      transportBus.emitEvent('state', event)
    })

    // === 5. 创建 Orchestrator ===
    const orch = new Orchestrator(transportBus, ipcBridge)
    orchRef.current = orch

    // === 订阅 UI 状态变更 ===
    const unsub = orch.onUIState((s) => setUI({ ...s }))

    // === 加载语音设置并初始化 ===
    window.electronAPI.getVoiceDictationSettings().then(s => {
      orch.toggleHandsfree(s).catch(() => {})
    }).catch(() => {})

    // === 同步 Agent 上下文到 Orchestrator ===
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
        console.error('[useVoiceOrchestrator] 同步Agent上下文失败:', error)
      }
    }

    const unsubscribeStreaming = store.sub(agentStreamingStatesAtom, syncAgentContext)
    const unsubscribeSession = store.sub(currentAgentSessionIdAtom, syncAgentContext)
    const unsubscribeMode = store.sub(appModeAtom, syncAgentContext)
    syncAgentContext()

    // === 监听设置变更事件 ===
    const handler = () => {
      window.electronAPI.getVoiceDictationSettings().then(s => {
        orch.toggleHandsfree(s).catch(() => {})
      }).catch(() => {})
    }
    const unsubscribeSettingsChanged = onVoiceSettingsChanged(handler)

    // === 监听 IPC 停止录音通知 ===
    const cts = window.electronAPI.onVoiceDictationToggleStop(() => {
      orch.stopRecording().catch(() => {})
    })

    return () => {
      unsub()
      unsubRequest()
      unsubTranscript()
      unsubState()
      unsubscribeStreaming?.()
      unsubscribeSession?.()
      unsubscribeMode?.()
      unsubscribeSettingsChanged()
      cts()
      orch.destroy()
      transportBus.clear()
      orchRef.current = null
    }
  }, [store])

  /**
   * 切换免提模式
   */
  const toggleHandsfree = React.useCallback(async (settings: VoiceDictationSettings) => {
    const orch = orchRef.current
    if (!orch) {
      console.warn('[useVoiceOrchestrator] Orchestrator 未初始化，无法切换免提')
      return
    }
    await orch.toggleHandsfree(settings)
  }, [])

  /**
   * 停止录音
   */
  const stopRecording = React.useCallback(async () => {
    const orch = orchRef.current
    if (!orch) {
      console.warn('[useVoiceOrchestrator] Orchestrator 未初始化，无法停止录音')
      return
    }
    await orch.stopRecording()
  }, [])

  return {
    ui,
    toggleHandsfree,
    stopRecording,
  }
}
