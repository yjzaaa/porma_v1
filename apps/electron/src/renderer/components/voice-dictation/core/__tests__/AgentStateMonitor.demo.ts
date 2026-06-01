/**
 * Agent状态监听器演示脚本
 * 展示状态监听器和日志功能
 */

import { AgentStateMonitor } from '../AgentStateMonitor'

// 创建监听器实例
const monitor = new AgentStateMonitor()

console.log('=== Agent状态监听器演示 ===\n')

// 演示1: 初始状态
console.log('1. 初始状态检查:')
const initialContext = monitor.getCurrentContext()
console.log(`   模式: ${initialContext.mode}`)
console.log(`   状态: ${initialContext.state}`)
console.log(`   循环状态: ${initialContext.loopState}`)
console.log(`   可接受输入: ${initialContext.canAcceptInput}\n`)

// 演示2: LLM处理状态
console.log('2. 模拟LLM处理中:')
monitor.updateAgentState({
  streamingState: {
    running: true,
    content: 'Agent正在思考用户的问题...',
    toolActivities: []
  }
})
const processingContext = monitor.getCurrentContext()
console.log(`   循环状态: ${processingContext.loopState}`)
console.log(`   可接受输入: ${processingContext.canAcceptInput}\n`)

// 演示3: 工具执行状态
console.log('3. 模拟工具执行中:')
monitor.updateAgentState({
  streamingState: {
    running: true,
    content: '正在执行文件写入操作...',
    toolActivities: ['file_write']
  }
})
const toolExecutingContext = monitor.getCurrentContext()
console.log(`   循环状态: ${toolExecutingContext.loopState}`)
console.log(`   活跃工具: ${toolExecutingContext.activeToolCalls.join(', ')}`)
console.log(`   可接受输入: ${toolExecutingContext.canAcceptInput}\n`)

// 演示4: 错误状态
console.log('4. 模拟错误状态:')
monitor.updateAgentState({ hasError: true })
const errorContext = monitor.getCurrentContext()
console.log(`   循环状态: ${errorContext.loopState}`)
console.log(`   可接受输入: ${errorContext.canAcceptInput}\n`)

// 演示5: 等待用户输入
console.log('5. 回到等待用户输入状态:')
monitor.updateAgentState({
  hasError: false,
  streamingState: {
    running: false,
    content: '',
    toolActivities: []
  }
})
const waitingContext = monitor.getCurrentContext()
console.log(`   循环状态: ${waitingContext.loopState}`)
console.log(`   可接受输入: ${waitingContext.canAcceptInput}\n`)

// 演示6: 消息管理
console.log('6. 添加最近消息:')
monitor.addRecentMessage('用户: 请帮我分析这个文件')
monitor.addRecentMessage('Agent: 好的，我来分析文件内容')
monitor.addRecentMessage('Agent: 我需要先读取文件...')
const messageContext = monitor.getCurrentContext()
console.log(`   最近消息数量: ${messageContext.recentMessages.length}`)
console.log(`   最近消息: ${messageContext.recentMessages.join(' | ')}\n`)

// 演示7: 即时指令
console.log('7. 测试即时指令（即使在工具执行中也应该被接受）:')
monitor.updateAgentState({
  streamingState: {
    running: true,
    content: '正在执行关键操作...',
    toolActivities: ['database_write']
  }
})
const canAcceptImmediate = monitor.canAcceptInput('immediate_command')
console.log(`   即时指令可接受: ${canAcceptImmediate}\n`)

// 清理
console.log('8. 清理资源:')
monitor.dispose()
console.log('   监听器已销毁')

console.log('\n=== 演示完成 ===')