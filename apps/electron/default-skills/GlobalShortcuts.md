# GlobalShortcuts — 全局快捷键与自动发送

> **代码位置**: `apps/electron/src/renderer/components/shortcuts/GlobalShortcuts.tsx`
> **组件类型**: React 功能组件（渲染 null）
> **核心职责**: 语音输入自动发送、全局快捷键注册

## 📋 概述

GlobalShortcuts 是一个永不销毁的顶层组件，负责：
- 监听 `voice-dictation:insert-text` IPC 事件
- 判断是否自动发送到 Agent
- 执行自动发送前的乐观更新

## 💡 核心代码：自动发送流程

**文件位置**: `GlobalShortcuts.tsx:61-124`

```typescript
function tryAutoSendAgent(store, text, voiceSettings) {
  // 1. 判断是否自动发送
  if (!shouldAutoSend(text, voiceSettings?.autoSendEnabled ?? true, 'always')) return

  // 2. 清除草稿（立即反馈）
  store.set(agentSessionDraftsAtom, (prev) => {
    const map = new Map(prev)
    map.delete(sessionId)
    return map
  })

  // 3. 设置流式状态（与手动发送一致）
  store.set(agentStreamingStatesAtom, (prev) => {
    const map = new Map(prev)
    map.set(sessionId, { running: true, content: '', startedAt: Date.now() })
    return map
  })

  // 4. 乐观插入用户消息（UI 立即显示）
  store.set(liveMessagesMapAtom, (prev) => {
    const existing = map.get(sessionId) ?? []
    return [...existing, {
      type: 'user',
      message: { content: [{ type: 'text', text }] },
      _createdAt: Date.now(),
    }]
  })

  // 5. 通过 IPC 发送给主进程
  window.electronAPI.sendAgentMessage({
    sessionId, userMessage: text, channelId, workspaceId,
  }).catch(console.error)
}
```

## 🔄 提交流程

```
Orchestrator.Session.completeRecording()
  → IPC commitVoiceDictation
    → text-output-service.commitVoiceDictationText()
      → outputMode='auto' 且 Proma 焦点 → INSERT_TEXT IPC 推送
      → 否则 → 光标粘贴 / 剪贴板

INSERT_TEXT → onVoiceDictationInsertText()
  → 路径 A: TipTap 编辑器拦截 → tryAutoSendAgent()
  → 路径 B: Agent 草稿写入 → shouldAutoSend() → sendAgentMessage()
```

## 🔗 相关文档

- [voice-auto-send 自动发送逻辑](../voice-dictation/voice-auto-send.md)
- [VoiceFloatingPanel 组件](../voice-dictation/VoiceFloatingPanel.md)
- [文本输出服务](../../main/lib/text/text-output-service.md)
