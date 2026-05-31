# Proma 架构文档

> 按代码目录层级组织的架构图文档集，补充根 `CLAUDE.md` 中未展开的 Mermaid 图和详细组件列表。

## 层级导航

| 文档 | 目录 | 内容 |
|------|------|------|
| [06-electron-main](./06-electron-main.md) | `apps/electron/src/main/` | 主进程服务层架构 + IPC 四层链路 + Preload API 表 |
| [08-electron-renderer](./08-electron-renderer.md) | `apps/electron/src/renderer/` | React UI 架构 + Jotai Atoms 全览 |
| [10-voice-dictation-ipc](./10-voice-dictation-ipc.md) | `apps/electron/src/` | 语音输入完整时序图 + ASR 协议细节 |

> **注意**: Monorepo 结构、包依赖、构建流程等内容已在根 `CLAUDE.md` 中详述，此处不再重复。

## 核心数据流

### Chat / Agent 基础流程

```
用户输入 (Renderer)
    │
    ▼
window.electronAPI.sendMessage()
    │ IPC (contextBridge)
    ▼
ipcMain.handle('chat:send-message')
    │
    ▼
chat-service.ts / agent-orchestrator.ts
    │
    ▼
Provider Adapter (core) → AI API
    │
    ▼ (SSE Stream)
webContents.send() → IPC 推送
    │
    ▼
useGlobalChatListeners / useGlobalAgentListeners
    │
    ▼
Jotai Atom 更新 → React 重渲染
```

### 语音输入完整流程

```
用户语音 → 音频采集 → PCM 转换 → IPC 调用 → 豆包 ASR (gzip)
    → WebSocket 上传 → 识别 → IPC 推送 → 文本合并
    → VAD 自动停止 → 文本输出服务 → 自动发送判断
    → Agent 服务 → Claude API → IPC 推送 → Jotai Atom → React 重渲染
```

> 详细时序图见 [10-voice-dictation-ipc.md](./10-voice-dictation-ipc.md)。
