/**
 * VoiceStateMachine - 语音识别状态机
 *
 * 基于状态模式+策略模式的完整状态流转系统
 *
 * 核心职责:
 *   1. 定义所有语音识别状态
 *   2. 为每个状态定义明确的行为策略
 *   3. 管理状态转换规则和转换逻辑
 *   4. 提供统一的状态变更通知接口
 */

import type { VoiceUIState } from '../../components/voice-dictation/types/panel'
import type { VoiceDictationSettings } from '@/types/settings'
import { createLogger } from '../utils/logger'

/**
 * 语音识别状态枚举
 */
export enum VoiceState {
  STOPPED = 'stopped',
  LISTENING = 'listening',
  RECORDING = 'recording',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

/**
 * 状态转换上下文
 */
export interface StateTransitionContext {
  /** 当前会话ID */
  sessionId: string | null
  /** 转录文本 */
  transcript: string
  /** 处理消息 */
  message: string
  /** 音量 */
  volume: number
  /** 语音设置 */
  settings: VoiceDictationSettings | null
  /** 转换原因 */
  reason: string
  /** 额外数据 */
  extra?: Record<string, any>
}

/**
 * 状态行为策略接口
 */
interface StateBehavior {
  /** 进入状态时的行为 */
  enter(context: StateTransitionContext): VoiceUIState
  /** 离开状态时的行为 */
  exit(context: StateTransitionContext): void
  /** 允许的下一状态 */
  allowedNextStates(): VoiceState[]
}

/**
 * 已停止状态行为
 */
class StoppedStateBehavior implements StateBehavior {
  enter(context: StateTransitionContext): VoiceUIState {
    return {
      state: VoiceState.STOPPED,
      volume: 0,
      transcript: '',
      message: '语音识别已停止',
      settings: context.settings
    }
  }

  exit(context: StateTransitionContext): void {
    // 清理工作
  }

  allowedNextStates(): VoiceState[] {
    return [VoiceState.LISTENING]
  }
}

/**
 * 监听状态行为
 */
class ListeningStateBehavior implements StateBehavior {
  enter(context: StateTransitionContext): VoiceUIState {
    return {
      state: VoiceState.LISTENING,
      volume: context.volume,
      transcript: '',
      message: '',
      settings: context.settings
    }
  }

  exit(context: StateTransitionContext): void {
    // 清理工作
  }

  allowedNextStates(): VoiceState[] {
    return [VoiceState.RECORDING, VoiceState.STOPPED]
  }
}

/**
 * 录音状态行为
 */
class RecordingStateBehavior implements StateBehavior {
  enter(context: StateTransitionContext): VoiceUIState {
    return {
      state: VoiceState.RECORDING,
      volume: context.volume,
      transcript: context.transcript,
      message: context.message || '录音中...',
      settings: context.settings
    }
  }

  exit(context: StateTransitionContext): void {
    // 清理工作
  }

  allowedNextStates(): VoiceState[] {
    return [VoiceState.PROCESSING, VoiceState.STOPPED, VoiceState.COMPLETED, VoiceState.ERROR]
  }
}

/**
 * 处理状态行为
 */
class ProcessingStateBehavior implements StateBehavior {
  enter(context: StateTransitionContext): VoiceUIState {
    return {
      state: VoiceState.PROCESSING,
      volume: 0,
      transcript: context.transcript,
      message: '处理中...',
      settings: context.settings
    }
  }

  exit(context: StateTransitionContext): void {
    // 清理工作
  }

  allowedNextStates(): VoiceState[] {
    return [VoiceState.COMPLETED, VoiceState.ERROR, VoiceState.LISTENING]
  }
}

/**
 * 完成状态行为
 */
class CompletedStateBehavior implements StateBehavior {
  enter(context: StateTransitionContext): VoiceUIState {
    return {
      state: VoiceState.COMPLETED,
      volume: 0,
      transcript: context.transcript,
      message: context.message || '已完成',
      settings: context.settings
    }
  }

  exit(context: StateTransitionContext): void {
    // 清理工作
  }

  allowedNextStates(): VoiceState[] {
    return [VoiceState.LISTENING, VoiceState.STOPPED]
  }
}

/**
 * 错误状态行为
 */
class ErrorStateBehavior implements StateBehavior {
  enter(context: StateTransitionContext): VoiceUIState {
    return {
      state: VoiceState.ERROR,
      volume: 0,
      transcript: context.transcript,
      message: context.message || '发生错误',
      settings: context.settings
    }
  }

  exit(context: StateTransitionContext): void {
    // 清理工作
  }

  allowedNextStates(): VoiceState[] {
    return [VoiceState.LISTENING, VoiceState.STOPPED]
  }
}

/**
 * 语音识别状态机
 */
export class VoiceStateMachine {
  private currentState: VoiceState = VoiceState.STOPPED
  private behaviors: Map<VoiceState, StateBehavior>
  private stateChangeListeners: Set<(state: VoiceUIState) => void> = new Set()
  private logger = createLogger('语音状态机')

  constructor() {
    // 初始化所有状态行为
    this.behaviors = new Map([
      [VoiceState.STOPPED, new StoppedStateBehavior()],
      [VoiceState.LISTENING, new ListeningStateBehavior()],
      [VoiceState.RECORDING, new RecordingStateBehavior()],
      [VoiceState.PROCESSING, new ProcessingStateBehavior()],
      [VoiceState.COMPLETED, new CompletedStateBehavior()],
      [VoiceState.ERROR, new ErrorStateBehavior()]
    ])

    this.logger.info('语音状态机初始化完成', { initialState: this.currentState })
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): VoiceState {
    return this.currentState
  }

  /**
   * 状态转换
   */
  transition(
    targetState: VoiceState,
    context: StateTransitionContext
  ): VoiceUIState {
    // 1. 检查状态转换是否合法
    if (!this.isValidTransition(targetState)) {
      this.logger.warn('非法状态转换被拒绝', {
        from: this.currentState,
        to: targetState,
        reason: context.reason
      })
      return this.getCurrentUIState(context)
    }

    // 2. 离开当前状态
    const currentBehavior = this.behaviors.get(this.currentState)
    if (currentBehavior) {
      currentBehavior.exit(context)
    }

    // 3. 进入新状态
    const oldState = this.currentState
    this.currentState = targetState

    const newBehavior = this.behaviors.get(targetState)
    if (!newBehavior) {
      this.logger.error('目标状态行为不存在', { targetState })
      return this.getCurrentUIState(context)
    }

    const newUIState = newBehavior.enter(context)

    // 4. 通知状态变更
    this.notifyStateChange(newUIState)

    this.logger.info('状态转换完成', {
      from: oldState,
      to: targetState,
      reason: context.reason
    })

    return newUIState
  }

  /**
   * 检查状态转换是否合法
   */
  private isValidTransition(targetState: VoiceState): boolean {
    if (this.currentState === targetState) {
      return true // 允许自转换
    }

    const currentBehavior = this.behaviors.get(this.currentState)
    if (!currentBehavior) {
      return false
    }

    return currentBehavior.allowedNextStates().includes(targetState)
  }

  /**
   * 获取当前UI状态
   */
  private getCurrentUIState(context: StateTransitionContext): VoiceUIState {
    const currentBehavior = this.behaviors.get(this.currentState)
    if (!currentBehavior) {
      return {
        state: VoiceState.STOPPED,
        volume: 0,
        transcript: '',
        message: '状态异常',
        settings: null
      }
    }
    return currentBehavior.enter(context)
  }

  /**
   * 添加状态变更监听器
   */
  onStateChange(listener: (state: VoiceUIState) => void): () => void {
    this.stateChangeListeners.add(listener)
    this.logger.debug('添加状态变更监听器', {
      totalListeners: this.stateChangeListeners.size
    })

    // 返回取消订阅函数
    return () => {
      this.stateChangeListeners.delete(listener)
      this.logger.debug('移除状态变更监听器', {
        totalListeners: this.stateChangeListeners.size
      })
    }
  }

  /**
   * 通知状态变更
   */
  private notifyStateChange(state: VoiceUIState): void {
    this.stateChangeListeners.forEach(listener => {
      try {
        listener(state)
      } catch (error) {
        this.logger.error('状态变更监听器执行失败', {
          error: error instanceof Error ? error.message : '未知错误'
        })
      }
    })
  }

  /**
   * 重置状态机
   */
  reset(context: StateTransitionContext): void {
    this.logger.info('重置状态机')
    this.transition(VoiceState.STOPPED, {
      ...context,
      reason: '状态机重置'
    })
  }

  /**
   * 销毁状态机
   */
  dispose(): void {
    this.logger.info('销毁状态机', {
      finalState: this.currentState,
      listeners: this.stateChangeListeners.size
    })
    this.stateChangeListeners.clear()
    this.behaviors.clear()
  }
}