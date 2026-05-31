# Proma 文档

> 项目工程文档，补充根目录 `CLAUDE.md` 中未展开的深度内容。

## 文档结构

```
docs/
├── arch/           # 架构文档（Mermaid 图 + 详细组件/Atom 列表）
├── code/           # 代码级文档（按代码目录组织）
├── modules/        # 深度模块文档（11 个核心模块）
├── superpowers/    # 设计 Spec
└── plans/          # 实施计划
```

## 快速导航

### 架构文档 (`arch/`)

| 文档 | 覆盖范围 |
|------|---------|
| [arch/README.md](arch/README.md) | 架构导航地图 + 核心数据流 |
| [arch/06-electron-main.md](arch/06-electron-main.md) | 主进程服务层 + IPC 四层链路 + Preload API 表 |
| [arch/08-electron-renderer.md](arch/08-electron-renderer.md) | 渲染进程架构 + Jotai Atoms 全览 |
| [arch/10-voice-dictation-ipc.md](arch/10-voice-dictation-ipc.md) | 语音输入完整时序图 + ASR 协议细节 |

> **注意**: `arch/01`~`05` 的内容已被根 `CLAUDE.md` 覆盖，不再单独维护。

### 代码文档 (`code/`)

| 文档 | 覆盖范围 |
|------|---------|
| [code/main/lib/README.md](code/main/lib/README.md) | 主进程 30 个业务模块分类导航 |
| [code/main/lib/text/text-output-service.md](code/main/lib/text/text-output-service.md) | 文本输出路由（Proma 输入框 / 光标 / 剪贴板）|
| [code/renderer/components/voice-dictation/VoiceFloatingPanel.md](code/renderer/components/voice-dictation/VoiceFloatingPanel.md) | 语音输入浮窗组件（OO 架构）|
| [code/renderer/components/voice-dictation/voice-auto-send.md](code/renderer/components/voice-dictation/voice-auto-send.md) | 自动发送判断逻辑（三种模式）|
| [code/renderer/components/shortcuts/GlobalShortcuts.md](code/renderer/components/shortcuts/GlobalShortcuts.md) | 全局快捷键 + 自动发送乐观更新 |

### 模块深度文档 (`modules/`)

每个文件对应一个核心模块的深度解析（架构图、时序图、代码解析、依赖关系）：

| 模块 | 文档 |
|------|------|
| Agent 会话管理 | [agent-session-manager.md](modules/agent-session-manager.md) |
| Agent 工作区管理 | [agent-workspace-manager.md](modules/agent-workspace-manager.md) |
| Agent 编排流水线 | [agent-pipeline-stages.md](modules/agent-pipeline-stages.md) |
| Chat 流式服务 | [chat-service.md](modules/chat-service.md) |
| Claude Agent SDK 适配器 | [claude-agent-adapter.md](modules/claude-agent-adapter.md) |
| 渠道管理 | [channel-manager.md](modules/channel-manager.md) |
| 对话管理 | [conversation-manager.md](modules/conversation-manager.md) |
| 配置路径 | [config-paths.md](modules/config-paths.md) |
| 飞书桥接 | [feishu-bridge.md](modules/feishu-bridge.md) |
| IPC Handlers | [ipc-handlers.md](modules/ipc-handlers.md) |
| Bridge 命令处理 | [bridge-command-handler.md](modules/bridge-command-handler.md) |

### 设计与计划

| 文档 | 内容 |
|------|------|
| [大文件重构设计](superpowers/specs/2026-05-29-large-file-refactor-design.md) | 6 个大文件 DDD 拆分方案 |
| [语音免提优化计划](plans/2026-05-30-voice-handsfree.md) | VAD、唤醒词、自动发送 5 Phase 路线图 |
| [主动协作中心设计](proactive-scheduler-monitor-design.md) | Proactive Center 产品设计 |

## 按功能查找

| 我想... | 查看文档 |
|---------|---------|
| 理解系统架构 | `CLAUDE.md` → [arch/](arch/) |
| 了解语音输入完整流程 | [arch/10-voice-dictation-ipc.md](arch/10-voice-dictation-ipc.md) |
| 深入某个核心模块 | [modules/](modules/) |
| 修改 Agent 逻辑 | [modules/agent-pipeline-stages.md](modules/agent-pipeline-stages.md) |
| 修改 Chat 流式调用 | [modules/chat-service.md](modules/chat-service.md) |
| 添加新的 AI 渠道 | [modules/channel-manager.md](modules/channel-manager.md) |

## 模块文档模板

新增模块文档时遵循以下结构：

1. **概述** — 模块职责和在系统中的位置
2. **架构图** — Mermaid graph
3. **核心流程** — Mermaid 时序图
4. **关键文件** — 文件路径 + 职责 + 关键函数
5. **核心代码解析** — 关键代码片段 + 要点说明
6. **IPC 通道** — 通道名称 + 方向 + 作用
7. **依赖关系** — 依赖和被依赖的模块

---

**最后更新**: 2026-05-31
