/**
 * StateTransitionQueue - 状态转换队列系统
 *
 * 确保状态转换严格排队执行，解决异步状态覆盖问题
 *
 * 核心职责:
 *   1. 状态转换进入队列，按顺序执行
 *   2. 每个状态转换完成后，才能执行下一个
 *   3. 支持延迟转换，确保用户能看到中间状态
 *   4. 提供取消队列的功能
 */

import type { VoiceStateMachine } from './VoiceStateMachine'
import type { VoiceState, StateTransitionContext } from './VoiceStateMachine'

/**
 * 状态转换任务
 */
interface StateTransitionTask {
  targetState: VoiceState
  context: StateTransitionContext
  delay?: number  // 延迟时间（毫秒）
  priority: number  // 优先级，数字越小优先级越高
}

/**
 * 状态转换队列
 */
export class StateTransitionQueue {
  private queue: StateTransitionTask[] = []
  private isProcessing: boolean = false
  private currentTimer: ReturnType<typeof setTimeout> | null = null
  private stateMachine: VoiceStateMachine

  constructor(stateMachine: VoiceStateMachine) {
    this.stateMachine = stateMachine
  }

  /**
   * 添加状态转换到队列
   *
   * @param targetState 目标状态
   * @param context 转换上下文
   * @param delay 延迟时间（毫秒），默认0
   * @param priority 优先级，默认0（数字越小优先级越高）
   */
  enqueue(
    targetState: VoiceState,
    context: StateTransitionContext,
    delay: number = 0,
    priority: number = 0
  ): void {
    const task: StateTransitionTask = {
      targetState,
      context,
      delay,
      priority
    }

    // 按优先级插入队列
    this.insertByPriority(task)

    // 如果队列不在处理中，开始处理
    if (!this.isProcessing) {
      this.processQueue()
    }
  }

  /**
   * 按优先级插入任务
   */
  private insertByPriority(task: StateTransitionTask): void {
    // 找到合适的插入位置
    let insertIndex = this.queue.length
    for (let i = 0; i < this.queue.length; i++) {
      const existingTask = this.queue[i]
      if (existingTask && task.priority < existingTask.priority) {
        insertIndex = i
        break
      }
    }

    this.queue.splice(insertIndex, 0, task)
  }

  /**
   * 处理队列中的任务
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return  // 已经在处理中
    }

    this.isProcessing = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      await this.executeTask(task)
    }

    this.isProcessing = false
  }

  /**
   * 执行单个状态转换任务
   */
  private async executeTask(task: StateTransitionTask): Promise<void> {
    return new Promise((resolve) => {
      const executeTransition = () => {
        this.stateMachine.transition(task.targetState, task.context)
        resolve()  // 任务完成
      }

      const delay = task.delay ?? 0
      if (delay > 0) {
        // 延迟执行
        this.currentTimer = setTimeout(() => {
          executeTransition()
          this.currentTimer = null
        }, delay)
      } else {
        // 立即执行
        executeTransition()
      }
    })
  }

  /**
   * 清空队列
   */
  clear(): void {
    // 清除待执行的任务
    this.queue = []

    // 清除当前正在执行的定时器
    if (this.currentTimer) {
      clearTimeout(this.currentTimer)
      this.currentTimer = null
    }

    // 重置处理状态
    this.isProcessing = false
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * 是否正在处理队列
   */
  isActive(): boolean {
    return this.isProcessing || this.queue.length > 0
  }

  /**
   * 销毁队列
   */
  dispose(): void {
    this.clear()
  }
}