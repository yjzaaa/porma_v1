import type { UnifiedASRResult, AgentContext, IntelligentDecision } from '../types/intelligence'
import { AgentLoopState } from '../types/intelligence'
import { UnifiedIntelligenceDetector } from '../core/UnifiedIntelligenceDetector'
import { createLogger } from '../utils/logger'

/**
 * Agent感知发送器
 *
 * 核心职责:
 *   1. 结合ASR结果和Agent状态进行智能发送
 *   2. 支持三种发送策略：立即发送、排队等待、打断处理
 *   3. 消息优先级管理
 *   4. 即时指令解析和处理
 *
 * @example
 * ```ts
 * const dispatcher = new AgentAwareDispatcher()
 * const result = await dispatcher.dispatch(asrResult, agentContext)
 * console.log(result.action) // 'sent_immediately' | 'queued' | 'interrupted' | ...
 * ```
 */
export class AgentAwareDispatcher {
  private logger = createLogger('Agent感知发送器')
  private detector: UnifiedIntelligenceDetector
  private messageQueue: QueuedMessage[] = []
  private idleWatcherCallback: (() => void) | null = null

  constructor() {
    this.detector = new UnifiedIntelligenceDetector()
    this.logger.info('Agent感知发送器初始化完成')
  }

  /**
   * 智能发送决策
   *
   * 根据ASR结果和Agent状态，决定是否发送以及采用何种发送策略
   *
   * @param asrResult - ASR识别结果
   * @param agentContext - Agent上下文信息
   * @returns 发送决策结果
   */
  async dispatch(
    asrResult: UnifiedASRResult,
    agentContext: AgentContext
  ): Promise<DispatchResult> {

    this.logger.info('开始智能发送决策', {
      text: asrResult.text,
      confidence: asrResult.confidence,
      agentLoopState: agentContext.loopState
    })

    // 获取智能决策
    const decision = this.detector.makeIntelligentDecision(asrResult, agentContext)

    this.logger.debug('智能决策结果', {
      shouldSend: decision.shouldSend,
      sendStrategy: decision.sendStrategy,
      reasoning: decision.reasoning,
      confidence: decision.confidence
    })

    if (!decision.shouldSend) {
      this.logger.info('决策：不发送，继续等待')
      return {
        action: 'continue',
        reason: decision.reasoning
      }
    }

    // 根据策略执行发送
    this.logger.info('执行发送策略', { strategy: decision.sendStrategy })

    switch (decision.sendStrategy) {
      case 'immediate':
        return await this.sendImmediately(asrResult.text, agentContext)

      case 'interrupt':
        return await this.interruptAndHandle(asrResult.text, agentContext)

      case 'wait':
        return await this.queueAndWait(asrResult.text, agentContext)

      default:
        this.logger.error('未知发送策略', { strategy: decision.sendStrategy })
        return {
          action: 'failed',
          reason: '未知发送策略'
        }
    }
  }

  /**
   * 立即发送策略
   *
   * 当Agent空闲时，直接发送消息
   *
   * @param text - 要发送的文本
   * @param agentContext - Agent上下文
   * @returns 发送结果
   */
  private async sendImmediately(
    text: string,
    agentContext: AgentContext
  ): Promise<DispatchResult> {
    this.logger.info('执行立即发送', { text, context: agentContext.loopState })

    try {
      // 构造并发送消息
      await this.sendToAgent(text, agentContext)

      this.logger.info('立即发送成功', { text, timestamp: Date.now() })
      return {
        action: 'sent_immediately',
        reason: 'Agent空闲，立即发送',
        timestamp: Date.now()
      }
    } catch (error) {
      this.logger.error('立即发送失败', {
        text,
        error: error instanceof Error ? error.message : '未知错误'
      })
      return {
        action: 'failed',
        reason: `发送失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 打断并处理策略
   *
   * 识别即时指令（停止、撤销、取消）并执行相应操作
   *
   * @param command - 指令文本
   * @param agentContext - Agent上下文
   * @returns 处理结果
   */
  private async interruptAndHandle(
    command: string,
    agentContext: AgentContext
  ): Promise<DispatchResult> {
    this.logger.warn('准备打断Agent处理', { command, context: agentContext.loopState })

    try {
      // 解析指令类型
      const commandType = this.parseImmediateCommand(command)
      this.logger.debug('指令类型解析', { command, commandType })

      switch (commandType) {
        case 'stop':
          await this.interruptAgent()
          this.logger.info('Agent已停止')
          return { action: 'interrupted', reason: '已停止Agent处理' }

        case 'undo':
          await this.undoLastAction()
          this.logger.info('已撤销最近操作')
          return { action: 'undone', reason: '已撤销最近操作' }

        case 'cancel':
          await this.cancelCurrentTask()
          this.logger.info('已取消当前任务')
          return { action: 'cancelled', reason: '已取消当前任务' }

        default:
          this.logger.info('未知指令，作为普通消息发送')
          // 未知指令，作为普通消息发送
          return await this.sendImmediately(command, agentContext)
      }
    } catch (error) {
      this.logger.error('打断处理失败', {
        command,
        error: error instanceof Error ? error.message : '未知错误'
      })
      return {
        action: 'failed',
        reason: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 排队等待策略
   *
   * 当Agent忙碌时，将消息加入队列并等待Agent空闲时处理
   *
   * @param text - 要发送的文本
   * @param agentContext - Agent上下文
   * @returns 排队结果
   */
  private async queueAndWait(
    text: string,
    agentContext: AgentContext
  ): Promise<DispatchResult> {

    const priority = this.calculatePriority(text, agentContext)
    const queuedMessage: QueuedMessage = {
      content: text,
      timestamp: Date.now(),
      priority: priority,
      agentState: agentContext.loopState,
      agentContext
    }

    this.messageQueue.push(queuedMessage)

    this.logger.info('消息已加入排队', {
      text: text.substring(0, 20) + '...',
      priority,
      queuePosition: this.messageQueue.length,
      agentState: agentContext.loopState
    })

    // 设置Agent状态监听器，等待最佳时机
    this.setupIdleWatcher(() => {
      this.logger.info('Agent空闲监听器触发，准备处理队列')
      this.processQueue()
    })

    return {
      action: 'queued',
      reason: `Agent ${agentContext.loopState}，已排队等待`,
      queuePosition: this.messageQueue.length
    }
  }

  /**
   * 解析即时指令类型
   *
   * @param text - 指令文本
   * @returns 指令类型：stop|undo|cancel|unknown
   */
  private parseImmediateCommand(text: string): string {
    const command = text.toLowerCase().trim()

    this.logger.debug('解析即时指令', { text: command })

    if (command.includes('撤销') || command.includes('undo')) {
      this.logger.info('解析为撤销指令')
      return 'undo'
    }

    if (command.includes('停止') || command.includes('停下') || command.includes('stop')) {
      this.logger.info('解析为停止指令')
      return 'stop'
    }

    if (command.includes('取消') || command.includes('cancel')) {
      this.logger.info('解析为取消指令')
      return 'cancel'
    }

    this.logger.debug('未解析到已知指令类型')
    return 'unknown'
  }

  /**
   * 计算消息优先级
   *
   * 综合考虑消息长度、上下文相关性、等待时间等因素
   *
   * @param text - 消息文本
   * @param agentContext - Agent上下文
   * @returns 优先级分数 (0-100)
   */
  private calculatePriority(text: string, agentContext: AgentContext): number {
    let priority = 50 // 基础优先级

    // 长度优先级：较长消息优先
    if (text.length > 30) {
      priority += 20
      this.logger.debug('长消息优先级提升', { length: text.length, priority })
    } else if (text.length > 10) {
      priority += 10
      this.logger.debug('中等长度消息优先级提升', { length: text.length, priority })
    }

    // 上下文优先级：回复相关问题优先
    if (this.isReplyToQuestion(text, agentContext)) {
      priority += 30
      this.logger.info('回复问题优先级大幅提升', { priority })
    }

    // 时间优先级：等待时间越长优先级越高
    const age = Date.now() - agentContext.lastUserMessageTime
    if (age > 10000) {
      priority += 15
      this.logger.debug('等待时间较长，优先级提升', { age: (age / 1000) + 's', priority })
    }

    const finalPriority = Math.min(100, priority)
    this.logger.debug('最终优先级计算', {
      text: text.substring(0, 20) + '...',
      finalPriority
    })

    return finalPriority
  }

  /**
   * 判断是否是对问题的回复
   *
   * @param text - 用户文本
   * @param agentContext - Agent上下文
   * @returns 是否为问题回复
   */
  private isReplyToQuestion(text: string, agentContext: AgentContext): boolean {
    const recentMessages = agentContext.recentMessages || []
    if (recentMessages.length === 0) {
      this.logger.debug('无最近消息，非问题回复')
      return false
    }

    const lastMessage = recentMessages[recentMessages.length - 1]

    // Agent最后发送了问题 → 用户可能在回答
    if (lastMessage.includes('?') || lastMessage.includes('？')) {
      this.logger.debug('检测到问题回复', { lastMessage: lastMessage.substring(0, 20) + '...' })
      return true
    }

    return false
  }

  /**
   * 处理消息队列
   *
   * 按优先级排序并发送队列中的消息
   */
  private async processQueue(): Promise<void> {
    if (this.messageQueue.length === 0) {
      this.logger.debug('消息队列为空，无需处理')
      return
    }

    this.logger.info('开始处理消息队列', { queueLength: this.messageQueue.length })

    // 按优先级排序
    this.messageQueue.sort((a, b) => b.priority - a.priority)
    this.logger.debug('队列已按优先级排序')

    // 处理队列中的消息
    for (const message of this.messageQueue) {
      try {
        this.logger.info('处理排队消息', {
          text: message.content.substring(0, 20) + '...',
          priority: message.priority
        })

        await this.sendToAgent(message.content, message.agentContext || {
          mode: 'agent',
          state: 'idle',
          recentMessages: [],
          activeToolCalls: [],
          loopState: AgentLoopState.PRE_USER_INPUT,
          canAcceptInput: true,
          lastUserMessageTime: Date.now()
        })

        // 移除已发送的消息
        this.messageQueue = this.messageQueue.filter(m => m !== message)
        this.logger.debug('消息已从队列移除', { remaining: this.messageQueue.length })

      } catch (error) {
        this.logger.error('队列消息发送失败', {
          content: message.content.substring(0, 20) + '...',
          error: error instanceof Error ? error.message : '未知错误'
        })
        // 保留失败的消息，稍后重试
      }
    }

    this.logger.info('消息队列处理完成', { remaining: this.messageQueue.length })
  }

  /**
   * 设置空闲监听器
   *
   * 当Agent变为空闲状态时触发回调
   *
   * @param callback - 空闲时执行的回调
   */
  private setupIdleWatcher(callback: () => void): void {
    this.logger.debug('设置Agent空闲监听器')
    this.idleWatcherCallback = callback

    // TODO: 集成实际的Agent状态监听逻辑
    // 这里应该通过Agent状态监听器订阅状态变化
    // 暂时使用setTimeout模拟（生产环境中需要移除）
    // setTimeout(callback, 1000)
  }

  /**
   * 触发空闲回调（供外部调用）
   *
   * 当Agent状态变为空闲时，外部应调用此方法触发队列处理
   */
  public notifyAgentIdle(): void {
    this.logger.info('收到Agent空闲通知')
    if (this.idleWatcherCallback) {
      this.idleWatcherCallback()
    } else {
      this.logger.debug('无空闲回调，忽略通知')
    }
  }

  /**
   * 发送到Agent（需要集成实际发送逻辑）
   *
   * @param text - 消息文本
   * @param context - Agent上下文
   */
  private async sendToAgent(text: string, context: AgentContext): Promise<void> {
    this.logger.info('发送到Agent', { text, context: context.loopState })
    // TODO: 集成实际的Agent发送逻辑
    // 这里需要调用Proma的Agent发送API
    console.log('[发送] 发送到Agent:', text, '上下文:', context)
  }

  /**
   * 打断Agent（需要集成实际打断逻辑）
   *
   * @throws Error 如果打断失败
   */
  private async interruptAgent(): Promise<void> {
    this.logger.warn('打断Agent处理')
    // TODO: 集成实际的Agent打断逻辑
    // 这里需要调用Proma的Agent中断API
    console.log('[打断] 打断Agent处理')
  }

  /**
   * 撤销操作（需要集成实际撤销逻辑）
   *
   * @throws Error 如果撤销失败
   */
  private async undoLastAction(): Promise<void> {
    this.logger.warn('撤销最近操作')
    // TODO: 集成实际的撤销逻辑
    // 这里需要调用Proma的撤销API
    console.log('[撤销] 撤销最近操作')
  }

  /**
   * 取消任务（需要集成实际取消逻辑）
   *
   * @throws Error 如果取消失败
   */
  private async cancelCurrentTask(): Promise<void> {
    this.logger.warn('取消当前任务')
    // TODO: 集成实际的取消逻辑
    // 这里需要调用Proma的任务取消API
    console.log('[取消] 取消当前任务')
  }

  /**
   * 获取当前队列状态
   *
   * @returns 队列信息
   */
  public getQueueStatus(): { length: number; messages: QueuedMessage[] } {
    return {
      length: this.messageQueue.length,
      messages: [...this.messageQueue]
    }
  }

  /**
   * 清空消息队列
   *
   * 清除所有排队的消息
   */
  public clearQueue(): void {
    this.logger.info('清空消息队列', { previousLength: this.messageQueue.length })
    this.messageQueue = []
  }

  /**
   * 清理资源
   *
   * 清空队列并移除监听器
   */
  dispose(): void {
    this.logger.info('清理Agent感知发送器资源')
    this.messageQueue = []
    this.idleWatcherCallback = null
    this.detector = undefined as any
  }
}

/**
 * 排队消息接口
 */
interface QueuedMessage {
  /** 消息内容 */
  content: string
  /** 消息时间戳 */
  timestamp: number
  /** 优先级分数 (0-100) */
  priority: number
  /** Agent状态快照 */
  agentState: AgentLoopState
  /** Agent上下文（可选） */
  agentContext?: AgentContext
}

/**
 * 发送决策结果接口
 */
export interface DispatchResult {
  /** 执行的动作 */
  action: 'sent_immediately' | 'queued' | 'interrupted' | 'undone' | 'cancelled' | 'failed' | 'continue'
  /** 原因说明 */
  reason: string
  /** 队列位置（仅queued时有值） */
  queuePosition?: number
  /** 时间戳（部分动作有值） */
  timestamp?: number
}