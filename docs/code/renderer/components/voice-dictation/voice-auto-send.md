# voice-auto-send — 语音自动发送判断

> **代码位置**: `apps/electron/src/renderer/components/voice-dictation/utils/auto-send.ts`
> **相关组件**: [VoiceFloatingPanel](./VoiceFloatingPanel.md), [GlobalShortcuts](../shortcuts/GlobalShortcuts.md)

## 📋 概述

判断语音识别文本是否应该自动发送到 Agent/Chat。提供三种模式（always / smart / ai），当前默认使用 always 模式。

## 💡 核心代码

**文件位置**: `voice-auto-send.ts:33-74`

```typescript
const MIN_AUTO_SEND_LENGTH = 4

export function shouldAutoSend(
  text: string,
  enabled: boolean = true,
  mode: 'always' | 'smart' | 'ai' = 'always'
): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (!enabled) return false

  // 方案一：直接自动发送（当前默认）
  if (mode === 'always') {
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }

  // 方案二：启发式规则判断（预留）
  if (mode === 'smart') {
    if (trimmed.length < MIN_AUTO_SEND_LENGTH) return false
    if (SENTENCE_END_PUNCTUATION.test(trimmed)) return true
    if (INCOMPLETE_ENDINGS.test(trimmed)) return false
    if (trimmed.length > 20) return true
    return false
  }

  // 方案三：AI 模型判断（预留）
  if (mode === 'ai') {
    return trimmed.length >= MIN_AUTO_SEND_LENGTH
  }
}
```

## 📊 模式对比

| 模式 | 判断依据 | 准确性 | 延迟 | 当前状态 |
|------|---------|--------|------|---------|
| `always` | 文本长度 >= 4 字符 | 中 | 零 | **默认启用** |
| `smart` | 标点 + 结尾词 + 长度正则 | 中高 | 零 | 预留，代码已就绪 |
| `ai` | 轻量 AI 模型调用 | 高 | ~800ms | 预留，需创建服务 |

## 🔗 相关文档

- [VoiceFloatingPanel 组件](./VoiceFloatingPanel.md) — OO 架构语音浮窗
- [GlobalShortcuts 全局快捷键](../shortcuts/GlobalShortcuts.md) — 自动发送触发逻辑
