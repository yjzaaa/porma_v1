# text-output-service — 文本输出路由

> **代码位置**: `apps/electron/src/main/lib/text/text-output-service.ts`
> **上游**: [Doubao ASR Service](../integration/README.md)
> **下游**: [VoiceFloatingPanel](../../../renderer/components/voice-dictation/VoiceFloatingPanel.md), [GlobalShortcuts](../../../renderer/components/shortcuts/GlobalShortcuts.md)

## 📋 概述

语音识别完成后，判断文本输出到哪个目标位置：Proma 输入框、当前光标位置或系统剪贴板。

## 💡 核心代码

**文件位置**: `text-output-service.ts:22-50`

```typescript
export async function commitVoiceDictationText(
  text: string,
  settings: VoiceDictationSettings,
): Promise<VoiceDictationCommitResult> {
  // 判断目标位置
  const shouldWriteProma =
    settings.outputMode === 'proma-input' ||
    (settings.outputMode === 'auto' && targetWasPromaInput)

  if (shouldWriteProma && mainWindow && !mainWindow.isDestroyed()) {
    // 单向推送至 Proma 输入框
    mainWindow.webContents.send(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, { text: trimmed })
    return { mode: 'proma-input', success: true, message: '已写入 Proma 输入框' }
  }

  // 降级：光标位置或剪贴板
  if (settings.outputMode === 'auto') {
    const result = await pasteTextAtCurrentCursor(trimmed)
    return result.success ? result : { mode: 'clipboard', success: true }
  }

  clipboard.writeText(trimmed)
  return { mode: 'clipboard', success: true }
}
```

## 📊 输出模式

| outputMode | 目标 | 行为 |
|-----------|------|------|
| `proma-input` | Proma 输入框 | 始终写入输入框 |
| `auto` | 智能判断 | Proma 焦点 → 输入框；否则 → 光标粘贴或剪贴板 |
| `cursor` | 当前光标 | 模拟系统粘贴 |

## 🔌 IPC 通道

| 通道 | 方向 | 作用 |
|------|------|------|
| `voice-dictation:insert-text` | 主→渲染 | 将文本推送至 Proma 输入框 |

## 🔗 相关文档

- [语音输入完整 IPC 流程](../../../arch/10-voice-dictation-ipc.md)
- [VoiceFloatingPanel 组件](../../../renderer/components/voice-dictation/VoiceFloatingPanel.md)
