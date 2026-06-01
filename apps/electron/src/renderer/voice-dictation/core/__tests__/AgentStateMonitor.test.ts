import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { AgentStateMonitor } from '../AgentStateMonitor'
import { AgentLoopState } from '../../types/intelligence'

describe('AgentStateMonitor', () => {
  let monitor: AgentStateMonitor

  beforeEach(() => {
    monitor = new AgentStateMonitor()
  })

  afterEach(() => {
    monitor.dispose()
  })

  describe('初始化', () => {
    test('应该正确初始化监听器', () => {
      const context = monitor.getCurrentContext()
      
      expect(context.mode).toBe('agent')
      expect(context.state).toBe('idle')
      expect(context.loopState).toBe(AgentLoopState.PRE_USER_INPUT)
      expect(context.canAcceptInput).toBe(true)
    })

    test('应该有默认的初始状态', () => {
      const context = monitor.getCurrentContext()
      
      expect(context.recentMessages).toEqual([])
      expect(context.activeToolCalls).toEqual([])
      expect(context.lastUserMessageTime).toBeGreaterThan(0)
    })
  })

  describe('Agent循环状态检测', () => {
    test('应该检测到错误状态', () => {
      monitor.updateAgentState({ hasError: true })
      
      const context = monitor.getCurrentContext()
      
      expect(context.loopState).toBe(AgentLoopState.ERROR_STATE)
      expect(context.canAcceptInput).toBe(true)
    })

    test('应该检测到LLM处理状态', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Thinking...',
          toolActivities: []
        }
      })
      
      const context = monitor.getCurrentContext()
      
      expect(context.loopState).toBe(AgentLoopState.LLM_PROCESSING)
      expect(context.canAcceptInput).toBe(false)
    })

    test('应该检测到工具执行状态', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Using tools...',
          toolActivities: ['file_write']
        }
      })
      
      const context = monitor.getCurrentContext()
      
      expect(context.loopState).toBe(AgentLoopState.TOOL_EXECUTING)
      expect(context.canAcceptInput).toBe(false)
    })

    test('应该检测到等待用户输入状态', () => {
      monitor.updateAgentState({
        streamingState: {
          running: false,
          content: '',
          toolActivities: []
        }
      })
      
      const context = monitor.getCurrentContext()
      
      expect(context.loopState).toBe(AgentLoopState.PRE_USER_INPUT)
      expect(context.canAcceptInput).toBe(true)
    })

    test('应该检测到后处理状态', () => {
      monitor.updateAgentState({
        streamingState: {
          running: false,
          content: 'Completed',
          toolActivities: []
        }
      })
      
      const context = monitor.getCurrentContext()
      
      expect(context.loopState).toBe(AgentLoopState.POST_PROCESSING)
      expect(context.canAcceptInput).toBe(false)
    })
  })

  describe('工具上下文分析', () => {
    test('关键工具应该返回TOOL_EXECUTING状态', () => {
      const criticalTools = ['file_write', 'database_write', 'system_modify']
      
      criticalTools.forEach(tool => {
        monitor.updateAgentState({
          streamingState: {
            running: true,
            content: 'Executing critical tool...',
            toolActivities: [tool]
          }
        })
        
        const context = monitor.getCurrentContext()
        expect(context.loopState).toBe(AgentLoopState.TOOL_EXECUTING)
        expect(context.canAcceptInput).toBe(false)
      })
    })

    test('可打断工具应该返回POST_PROCESSING状态', () => {
      const interruptibleTools = ['web_search', 'data_read', 'calculation']
      
      interruptibleTools.forEach(tool => {
        monitor.updateAgentState({
          streamingState: {
            running: true,
            content: 'Executing interruptible tool...',
            toolActivities: [tool]
          }
        })
        
        const context = monitor.getCurrentContext()
        expect(context.loopState).toBe(AgentLoopState.POST_PROCESSING)
        expect(context.canAcceptInput).toBe(false)
      })
    })

    test('未知工具应该采用保守策略', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Executing unknown tool...',
          toolActivities: ['unknown_tool']
        }
      })
      
      const context = monitor.getCurrentContext()
      
      expect(context.loopState).toBe(AgentLoopState.TOOL_EXECUTING)
      expect(context.canAcceptInput).toBe(false)
    })
  })

  describe('用户输入判断', () => {
    test('即时指令总是可以被接受', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Processing...',
          toolActivities: ['file_write']
        }
      })
      
      const canAccept = monitor.canAcceptInput('immediate_command')
      
      expect(canAccept).toBe(true)
    })

    test('PRE_USER_INPUT状态应该接受普通输入', () => {
      monitor.updateAgentState({
        streamingState: {
          running: false,
          content: '',
          toolActivities: []
        }
      })
      
      const canAccept = monitor.canAcceptInput()
      
      expect(canAccept).toBe(true)
    })

    test('ERROR_STATE状态应该接受普通输入', () => {
      monitor.updateAgentState({ hasError: true })
      
      const canAccept = monitor.canAcceptInput()
      
      expect(canAccept).toBe(true)
    })

    test('LLM_PROCESSING状态不应该接受普通输入', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Thinking...',
          toolActivities: []
        }
      })
      
      const canAccept = monitor.canAcceptInput()
      
      expect(canAccept).toBe(false)
    })

    test('TOOL_EXECUTING状态不应该接受普通输入', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Executing...',
          toolActivities: ['file_write']
        }
      })
      
      const canAccept = monitor.canAcceptInput()
      
      expect(canAccept).toBe(false)
    })
  })

  describe('状态更新', () => {
    test('应该更新Agent模式', () => {
      monitor.updateAgentState({ mode: 'chat' })
      
      const context = monitor.getCurrentContext()
      expect(context.mode).toBe('chat')
    })

    test('应该更新Agent状态', () => {
      monitor.updateAgentState({ status: 'processing' })
      
      const context = monitor.getCurrentContext()
      expect(context.state).toBe('processing')
    })

    test('应该更新流式状态', () => {
      const newStreamingState = {
        running: true,
        content: 'New content',
        toolActivities: ['web_search']
      }
      
      monitor.updateAgentState({ streamingState: newStreamingState })
      
      const context = monitor.getCurrentContext()
      expect(context.activeToolCalls).toEqual(['web_search'])
      expect(context.loopState).toBe(AgentLoopState.POST_PROCESSING)
    })

    test('应该更新错误状态', () => {
      monitor.updateAgentState({ hasError: true })
      
      const context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.ERROR_STATE)
      expect(context.canAcceptInput).toBe(true)
    })

    test('应该更新最近消息', () => {
      const messages = ['Hello', 'How are you?', 'Help me']
      
      monitor.updateAgentState({ recentMessages: messages })
      
      const context = monitor.getCurrentContext()
      expect(context.recentMessages).toEqual(messages)
    })

    test('应该更新最后用户消息时间', () => {
      const newTime = Date.now() + 10000
      
      monitor.updateAgentState({ lastUserMessageTime: newTime })
      
      const context = monitor.getCurrentContext()
      expect(context.lastUserMessageTime).toBe(newTime)
    })
  })

  describe('消息管理', () => {
    test('应该添加最近消息', () => {
      monitor.addRecentMessage('First message')
      monitor.addRecentMessage('Second message')
      
      const context = monitor.getCurrentContext()
      expect(context.recentMessages).toEqual(['First message', 'Second message'])
    })

    test('应该只保留最近5条消息', () => {
      for (let i = 0; i < 10; i++) {
        monitor.addRecentMessage(`Message ${i + 1}`)
      }
      
      const context = monitor.getCurrentContext()
      expect(context.recentMessages.length).toBe(5)
      expect(context.recentMessages).toEqual([
        'Message 6',
        'Message 7',
        'Message 8',
        'Message 9',
        'Message 10'
      ])
    })
  })

  describe('状态重置', () => {
    test('重置后应该恢复到初始状态', () => {
      // 先设置一些复杂状态
      monitor.updateAgentState({
        mode: 'chat',
        status: 'processing',
        streamingState: {
          running: true,
          content: 'Complex state',
          toolActivities: ['file_write', 'database_write']
        },
        hasError: false,
        recentMessages: ['Message 1', 'Message 2']
      })
      
      // 重置
      monitor.reset()
      
      // 验证恢复到初始状态
      const context = monitor.getCurrentContext()
      expect(context.mode).toBe('agent')
      expect(context.state).toBe('idle')
      expect(context.loopState).toBe(AgentLoopState.PRE_USER_INPUT)
      expect(context.canAcceptInput).toBe(true)
      expect(context.recentMessages).toEqual([])
      expect(context.activeToolCalls).toEqual([])
    })
  })

  describe('复杂状态转换场景', () => {
    test('完整的工作流程状态转换', () => {
      // 1. 初始状态
      let context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.PRE_USER_INPUT)
      
      // 2. 用户发送消息后，开始LLM处理
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Thinking about user request...',
          toolActivities: []
        }
      })
      
      context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.LLM_PROCESSING)
      expect(context.canAcceptInput).toBe(false)
      
      // 3. Agent决定使用工具
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Using file write tool...',
          toolActivities: ['file_write']
        }
      })
      
      context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.TOOL_EXECUTING)
      expect(context.canAcceptInput).toBe(false)
      
      // 4. 工具执行完成，Agent进行后处理
      monitor.updateAgentState({
        streamingState: {
          running: false,
          content: 'Task completed',
          toolActivities: []
        }
      })
      
      context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.POST_PROCESSING)
      expect(context.canAcceptInput).toBe(false)
      
      // 5. 回到等待用户输入状态
      monitor.updateAgentState({
        streamingState: {
          running: false,
          content: '',
          toolActivities: []
        }
      })
      
      context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.PRE_USER_INPUT)
      expect(context.canAcceptInput).toBe(true)
    })

    test('错误恢复流程', () => {
      // 1. 正常处理中突然出错
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Processing...',
          toolActivities: ['database_write']
        }
      })
      
      let context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.TOOL_EXECUTING)
      
      // 2. 错误发生
      monitor.updateAgentState({ hasError: true })
      
      context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.ERROR_STATE)
      expect(context.canAcceptInput).toBe(true)
      
      // 3. 错误恢复
      monitor.updateAgentState({
        hasError: false,
        streamingState: {
          running: false,
          content: '',
          toolActivities: []
        }
      })
      
      context = monitor.getCurrentContext()
      expect(context.loopState).toBe(AgentLoopState.PRE_USER_INPUT)
      expect(context.canAcceptInput).toBe(true)
    })

    test('多工具连续执行场景', () => {
      const tools = ['web_search', 'data_read', 'file_write']
      
      tools.forEach(tool => {
        monitor.updateAgentState({
          streamingState: {
            running: true,
            content: `Executing ${tool}...`,
            toolActivities: [tool]
          }
        })
        
        const context = monitor.getCurrentContext()
        
        if (tool === 'file_write') {
          expect(context.loopState).toBe(AgentLoopState.TOOL_EXECUTING)
        } else {
          expect(context.loopState).toBe(AgentLoopState.POST_PROCESSING)
        }
      })
    })
  })

  describe('Agent上下文信息', () => {
    test('应该提供完整的Agent上下文', () => {
      monitor.updateAgentState({
        mode: 'agent',
        status: 'processing',
        streamingState: {
          running: true,
          content: 'Working on task...',
          toolActivities: ['web_search', 'data_read']
        },
        recentMessages: ['User request', 'Agent response'],
        lastUserMessageTime: Date.now()
      })
      
      const context = monitor.getCurrentContext()
      
      expect(context.mode).toBe('agent')
      expect(context.state).toBe('processing')
      expect(context.recentMessages).toEqual(['User request', 'Agent response'])
      expect(context.activeToolCalls).toEqual(['web_search', 'data_read'])
      expect(context.lastUserMessageTime).toBeGreaterThan(0)
      expect(typeof context.loopState).toBe('string')
      expect(typeof context.canAcceptInput).toBe('boolean')
    })
  })

  describe('资源清理', () => {
    test('dispose应该清理资源', () => {
      monitor.updateAgentState({
        streamingState: {
          running: true,
          content: 'Processing...',
          toolActivities: ['file_write']
        },
        recentMessages: ['Message 1', 'Message 2']
      })
      
      monitor.dispose()
      
      const context = monitor.getCurrentContext()
      expect(context.mode).toBe('agent')
      expect(context.state).toBe('idle')
      expect(context.recentMessages).toEqual([])
      expect(context.activeToolCalls).toEqual([])
    })
  })
})