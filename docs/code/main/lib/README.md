# 主进程业务模块

> **代码位置**: `apps/electron/src/main/lib/`
> **模块数量**: 30 个业务模块

## 模块分类

### 核心 AI 模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **Agent** | `lib/agent/` | 通用 Agent 执行引擎 |
| **Chat** | `lib/chat/` | 对话和工具执行 |
| **Channel** | `lib/channel/` | AI 渠道管理 |

### 语音输入模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **Integration** | `lib/integration/` | 豆包 ASR 语音识别 |
| **Text** | `lib/text/` | 文本输出和插入服务 |

### 第三方集成模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **Feishu** | `lib/feishu/` | 飞书机器人桥接 |
| **Dingtalk** | `lib/dingtalk/` | 钉钉机器人桥接 |
| **Wechat** | `lib/wechat/` | 微信机器人桥接 |
| **Bridge** | `lib/bridge/` | 通用消息桥接框架 |

### 系统功能模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **File** | `lib/file/` | 文件系统操作 |
| **Storage** | `lib/storage/` | 数据持久化 |
| **Memory** | `lib/memory/` | 长期记忆管理 |
| **System** | `lib/system/` | 系统级服务 |
| **Window** | `lib/window/` | 窗口管理 |

### 辅助模块

| 模块 | 路径 | 职责 |
|------|------|------|
| Conversation | `lib/conversation/` | 对话管理 |
| Git | `lib/git/` | Git 操作 |
| Network | `lib/network/` | 网络请求 |
| Runtime | `lib/runtime/` | 运行时环境 |
| Updater | `lib/updater/` | 应用更新 |

## 查找指南

- **添加新的 AI 渠道** → Channel 模块
- **集成新的第三方服务** → Integration 模块
- **修改语音输入** → Text 模块 + Integration 模块
- **添加新的机器人** → Feishu 或 Dingtalk 模块

## 相关文档

- [主进程详细架构图](../../../arch/06-electron-main.md) — 服务分层 Mermaid 图
- [语音输入完整流程](../../../arch/10-voice-dictation-ipc.md) — IPC 时序图
- [深度模块文档](../../../../modules/) — 各模块的架构图和代码解析

---

**最后更新**: 2026-05-31
