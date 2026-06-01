import type { AgentContext } from '../types/intelligence'
import { AgentLoopState } from '../types/intelligence'
import { createLogger } from '../utils/logger'

/**
 * Agent状态监听器
 * 
 * 核心职责:
 *   1. 实时监听Agent对话状态
 *   2. 精确检测Agent循环状态
 *   3. 判断用户输入时机
 *   4. 提供Agent上下文信息
 */
export class AgentStateMonitor {
  private logger = createLogger('Agent状态监听器')
  
  private currentState: {
    mode: 'agent' | 'chat'
    status: string
    streamingState: {
      running: boolean
      content: string
      toolActivities: string[]
    }
    hasError: boolean
    recentMessages: string[]
    lastUserMessageTime: number
  } = {
    mode: 'agent',
    status: 'idle',
    streamingState: { running: false, content: '', toolActivities: [] },
    hasError: false,
    recentMessages: [],
    lastUserMessageTime: Date.now()
  }
  
  constructor() {
    this.logger.info('Agent状态监听器初始化完成')
  }

  /**
   * 获取Agent当前上下文
   */
  getCurrentContext(): AgentContext {
    const context = {
      mode: this.currentState.mode,
      state: this.currentState.status,
      recentMessages: this.currentState.recentMessages,
      activeToolCalls: this.currentState.streamingState.toolActivities,
      loopState: this.detectLoopState(),
      canAcceptInput: this.canAcceptInputForContext(),
      lastUserMessageTime: this.currentState.lastUserMessageTime
    }
    
    this.logger.debug('获取Agent上下文', { 
      loopState: context.loopState,
      canAcceptInput: context.canAcceptInput,
      activeTools: context.activeToolCalls.length 
    })
    
    return context
  }
  
  /**
   * 精确检测Agent循环状态
   */
  private detectLoopState(): AgentLoopState {
    const { hasError, streamingState, status } = this.currentState
    
    this.logger.debug('开始Agent循环状态检测', { 
      hasError, 
      streamingRunning: streamingState.running,
      status 
    })
    
    // 错误状态 → 立即接受用户输入
    if (hasError) {
      this.logger.warn('检测到Agent错误状态')
      return AgentLoopState.ERROR_STATE
    }
    
    // 检查流式状态
    if (streamingState.running) {
      // 有工具活动 → 工具执行中
      if (streamingState.toolActivities.length > 0) {
        const toolState = this.analyzeToolContext(streamingState.toolActivities)
        this.logger.debug('工具执行状态分析', { 
          tools: streamingState.toolActivities,
          toolState 
        })
        return toolState
      }
      
      // 纯LLM处理中
      this.logger.debug('Agent处于LLM处理状态')
      return AgentLoopState.LLM_PROCESSING
    }
    
    // 没有流式状态 → 可能是空闲或等待输入
    if (!streamingState.running && streamingState.content === '' && !this.hasActiveStreaming()) {
      this.logger.info('Agent处于等待用户输入状态')
      return AgentLoopState.PRE_USER_INPUT
    }
    
    // 有内容但流式结束 → 后处理阶段
    this.logger.debug('Agent处于后处理阶段')
    return AgentLoopState.POST_PROCESSING
  }
  
  /**
   * 分析工具上下文
   */
  private analyzeToolContext(toolActivities: string[]): AgentLoopState {
    const criticalTools = ['file_write', 'database_write', 'system_modify']
    const interruptibleTools = ['web_search', 'data_read', 'calculation']
    
    const activeTool = toolActivities.length > 0 ? toolActivities[toolActivities.length - 1] : 'unknown'
    
    this.logger.debug('分析工具上下文', { activeTool, toolCount: toolActivities.length })
    
    if (criticalTools.includes(activeTool)) {
      this.logger.warn('检测到关键工具执行中，不允许打断', { tool: activeTool })
      // 关键工具：不允许打断
      return AgentLoopState.TOOL_EXECUTING
    }
    
    if (interruptibleTools.includes(activeTool)) {
      this.logger.info('检测到可打断工具', { tool: activeTool })
      // 可打断工具：等待自然结束点
      return AgentLoopState.POST_PROCESSING
    }
    
    // 未知工具：保守策略
    this.logger.warn('检测到未知工具，采用保守策略', { tool: activeTool })
    return AgentLoopState.TOOL_EXECUTING
  }
  
  /**
   * 检查是否有活跃的流式处理
   */
  private hasActiveStreaming(): boolean {
    // 检查实际的Agent流式状态
    const hasActive = this.currentState.streamingState.running
    this.logger.debug('检查活跃流式状态', { hasActive, running: this.currentState.streamingState.running })
    return hasActive
  }
  
  /**
   * 判断是否应该接受用户输入
   */
  canAcceptInput(intent?: string): boolean {
    const loopState = this.detectLoopState()
    
    this.logger.debug('判断是否接受用户输入', { 
      loopState, 
      intent 
    })
    
    // 即时指令总是可以接受
    if (intent === 'immediate_command') {
      this.logger.info('即时指令，允许接受')
      return true
    }
    
    // 普通消息根据Agent状态判断
    const canAccept = loopState === AgentLoopState.PRE_USER_INPUT || 
                      loopState === AgentLoopState.ERROR_STATE
    
    this.logger.info('用户输入接受判断', { canAccept, loopState })
    return canAccept
  }
  
  /**
   * 判断当前上下文是否可以接受用户输入
   */
  private canAcceptInputForContext(): boolean {
    const loopState = this.detectLoopState()
    const canAccept = loopState === AgentLoopState.PRE_USER_INPUT || 
                      loopState === AgentLoopState.ERROR_STATE
    
    this.logger.debug('上下文输入接受判断', { canAccept, loopState })
    return canAccept
  }
  
  /**
   * 更新Agent状态
   */
  updateAgentState(state: {
    mode?: 'agent' | 'chat'
    status?: string
    streamingState?: { running: boolean; content: string; toolActivities: string[] }
    hasError?: boolean
    recentMessages?: string[]
    lastUserMessageTime?: number
  }): void {
    const oldState = { ...this.currentState }
    
    if (state.mode !== undefined) {
      this.currentState.mode = state.mode
      this.logger.info('Agent模式更新', { old: oldState.mode, new: state.mode })
    }
    
    if (state.status !== undefined) {
      this.currentState.status = state.status
      this.logger.debug('Agent状态更新', { old: oldState.status, new: state.status })
    }
    
    if (state.streamingState !== undefined) {
      const oldRunning = this.currentState.streamingState.running
      this.currentState.streamingState = state.streamingState
      
      if (oldRunning !== state.streamingState.running) {
        this.logger.info('流式状态变化', { 
          old: oldRunning, 
          new: state.streamingState.running,
          toolCount: state.streamingState.toolActivities.length 
        })
      }
    }
    
    if (state.hasError !== undefined) {
      this.currentState.hasError = state.hasError
      if (state.hasError) {
        this.logger.error('Agent错误状态更新', { hasError: true })
      }
    }
    
    if (state.recentMessages !== undefined) {
      this.currentState.recentMessages = state.recentMessages
      this.logger.debug('最近消息更新', { count: state.recentMessages.length })
    }
    
    if (state.lastUserMessageTime !== undefined) {
      this.currentState.lastUserMessageTime = state.lastUserMessageTime
      this.logger.debug('最后用户消息时间更新')
    }
  }
  
  /**
   * 添加最近消息
   */
  addRecentMessage(message: string): void {
    this.currentState.recentMessages.push(message)
    
    // 只保留最近5条消息
    if (this.currentState.recentMessages.length > 5) {
      this.currentState.recentMessages = this.currentState.recentMessages.slice(-5)
    }
    
    this.logger.debug('添加最近消息', { 
      message: message.substring(0, 20) + '...',
      totalMessages: this.currentState.recentMessages.length 
    })
  }
  
  /**
   * 重置状态
   */
  reset(): void {
    this.logger.info('重置Agent状态监听器')
    this.currentState = {
      mode: 'agent',
      status: 'idle',
      streamingState: { running: false, content: '', toolActivities: [] },
      hasError: false,
      recentMessages: [],
      lastUserMessageTime: Date.now()
    }
  }
  
  /**
   * 销毁监听器
   */
  dispose(): void {
    this.logger.info('销毁Agent状态监听器')
    this.reset()
  }
}