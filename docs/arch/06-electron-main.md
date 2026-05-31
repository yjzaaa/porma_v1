# 06 — 主进程 + 服务层

> **目录**: [`apps/electron/src/main/`](../../apps/electron/src/main/)
> **上游**: [05-electron-app](./05-electron-app.md)
> **下游**: [07-electron-preload](./07-electron-preload.md) · [08-electron-renderer](./08-electron-renderer.md)

## 架构图

```mermaid
graph TB
    subgraph MainProcess["Main Process — 主进程 + 服务层"]
        direction TB

        subgraph EntryLayer["入口层"]
            main_ts["index.ts<br/>━━━━━━━━━━<br/>app.whenReady()<br/>创建 BrowserWindow<br/>注册 IPC handlers"]
            ipc_ts["ipc.ts (57KB)<br/>━━━━━━━━━━<br/>ipcMain.handle() 注册<br/>所有 IPC 通道处理器"]
            menu["menu.ts<br/>应用菜单"]
            tray["tray.ts<br/>系统托盘"]
        end

        subgraph CoreServices["核心业务服务"]
            agent_orch["agent-orchestrator.ts<br/>━━━━━━━━━━<br/>Agent 核心编排 (71KB)<br/>SDK query 调用<br/>消息持久化<br/>事件流处理<br/>自动标题生成"]
            chat_svc["chat-service.ts<br/>━━━━━━━━━━<br/>Chat 流式编排 (20KB)<br/>Provider 适配器集成<br/>消息持久化<br/>AbortController"]
            conv_mgr["conversation-manager.ts<br/>━━━━━━━━━━<br/>对话管理 (13KB)<br/>CRUD + JSONL 存储<br/>置顶 + 上下文分割"]
            channel_mgr["channel-manager.ts<br/>━━━━━━━━━━<br/>渠道管理 (16KB)<br/>CRUD + AES-256-GCM 加密<br/>连接测试 + 模型获取"]
        end

        subgraph AgentServices["Agent 子系统"]
            agent_sess["agent-session-manager.ts<br/>会话元数据 + JSONL"]
            agent_prompt["agent-prompt-builder.ts<br/>系统提示词构建 (18KB)"]
            agent_perm["agent-permission-service.ts<br/>工具权限检查"]
            agent_ask["agent-ask-user-service.ts<br/>用户交互处理"]
            agent_exit["agent-exit-plan-service.ts<br/>退出计划服务"]
            agent_ws["agent-workspace-manager.ts<br/>工作区管理 (16KB)"]
            agent_svc["agent-service.ts<br/>Agent 服务入口"]
            agent_bus["agent-event-bus.ts<br/>Agent 事件总线"]
            agent_valid["agent-tool-input-validator.ts<br/>工具输入校验"]
            agent_token["agent-tool-token-estimator.ts<br/>Token 估算"]
        end

        subgraph Integration["集成服务"]
            feishu["feishu-bridge.ts<br/>飞书集成 (68KB)"]
            feishu_mgr["feishu-bridge-manager.ts<br/>飞书桥接管理"]
            feishu_cfg["feishu-config.ts<br/>飞书配置"]
            feishu_msg["feishu-message.ts<br/>消息处理"]
            feishu_card["feishu/<br/>card-renderer / card-stream<br/>session-mirror / run-coordinator<br/>scoped-queue"]
            dingtalk["dingtalk-bridge.ts<br/>钉钉集成"]
            wechat["wechat-bridge.ts<br/>微信集成"]
            memory["memory-service.ts<br/>记忆管理"]
            memos["memos-client.ts<br/>Memos 笔记服务"]
        end

        subgraph ToolServices["工具 & 文件服务"]
            chat_tools["chat-tools/<br/>agent-recommend-tool<br/>http-tool-executor<br/>memory-tool<br/>web-search-tool<br/>nano-banana-tool"]
            attachment["attachment-service.ts<br/>附件管理"]
            doc_parser["document-parser.ts<br/>PDF/Office 解析"]
            chat_tool_exec["chat-tool-executor.ts<br/>工具执行引擎"]
            chat_tool_reg["chat-tool-registry.ts<br/>工具注册表"]
        end

        subgraph SystemServices["系统服务"]
            runtime["runtime-init.ts<br/>运行时初始化<br/>Shell + Bun + Git 检测"]
            config_paths["config-paths.ts<br/>配置路径管理<br/>~/.proma/ 结构"]
            settings["settings-service.ts<br/>应用设置持久化"]
            user_profile["user-profile-service.ts<br/>用户档案"]
            proxy_svc["proxy-settings-service.ts<br/>代理设置"]
            proxy_detect["system-proxy-detector.ts<br/>系统代理检测"]
            sp_mgr["system-prompt-manager.ts<br/>系统提示词管理"]
            storage["storage-service.ts<br/>通用存储服务"]
            migration["migration-service.ts<br/>数据迁移"]
            updater["updater/<br/>自动更新"]
        end

        subgraph Utils["工具 & 检测"]
            git_detect["git-detector.ts<br/>Git 检测"]
            bun_find["bun-finder.ts<br/>Bun 路径查找"]
            shell_env["shell-env.ts<br/>Shell 环境"]
            env_check["environment-checker.ts<br/>环境检查"]
            ws_watcher["workspace-watcher.ts<br/>文件系统监控"]
            tools_watcher["chat-tools-watcher.ts<br/>工具配置监控"]
            safe_file["safe-file.ts<br/>安全文件操作"]
            proxy_fetch["proxy-fetch.ts<br/>代理 fetch"]
            screenshot["screenshot-service.ts<br/>截图服务"]
            file_preview["file-preview-service.ts<br/>文件预览"]
            local_file["local-file-protocol.ts<br/>本地文件协议"]
        end

        EntryLayer --> CoreServices
        CoreServices --> AgentServices
        CoreServices --> Integration
        CoreServices --> ToolServices
        CoreServices --> SystemServices
        CoreServices --> Utils
    end

    style EntryLayer fill:#ffd43b,stroke:#f08c00
    style CoreServices fill:#a5d8ff,stroke:#1971c2
    style AgentServices fill:#d0bfff,stroke:#7048e8
    style Integration fill:#b2f2bb,stroke:#2f9e44
    style ToolServices fill:#ffc9c9,stroke:#e03131
    style SystemServices fill:#ffe8cc,stroke:#e8590c
    style Utils fill:#e9ecef,stroke:#495057
```

## 服务分层详解

### 入口层

| 文件 | 大小 | 职责 |
|------|------|------|
| [`index.ts`](../../apps/electron/src/main/index.ts) | — | app.whenReady()、创建窗口、注册所有 IPC |
| [`ipc.ts`](../../apps/electron/src/main/ipc.ts) | 57KB | 所有 `ipcMain.handle()` 处理器注册 |
| [`menu.ts`](../../apps/electron/src/main/menu.ts) | — | 应用菜单定义 |
| [`tray.ts`](../../apps/electron/src/main/tray.ts) | — | 系统托盘图标和菜单 |

### 核心业务服务

| 服务 | 文件 | 大小 | 核心职责 |
|------|------|------|----------|
| Agent 编排 | [`agent-orchestrator.ts`](../../apps/electron/src/main/lib/agent-orchestrator.ts) | 71KB | SDK query() 调用、并发守卫、消息持久化、事件流处理、自动标题 |
| Chat 编排 | [`chat-service.ts`](../../apps/electron/src/main/lib/chat-service.ts) | 20KB | Provider 适配器流式调用、消息持久化、AbortController |
| 对话管理 | [`conversation-manager.ts`](../../apps/electron/src/main/lib/conversation-manager.ts) | 13KB | 对话 CRUD、JSONL 存储、置顶、上下文分割 |
| 渠道管理 | [`channel-manager.ts`](../../apps/electron/src/main/lib/channel-manager.ts) | 16KB | 渠道 CRUD、API Key AES-256-GCM 加密、连接测试 |

### Agent 子系统

| 服务 | 文件 | 职责 |
|------|------|------|
| 会话管理 | [`agent-session-manager.ts`](../../apps/electron/src/main/lib/agent-session-manager.ts) | SDK 消息持久化、会话元数据 CRUD、JSONL 存储 |
| 提示词构建 | [`agent-prompt-builder.ts`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) | 动态上下文构建、内置 Agent 构建 |
| 权限管理 | [`agent-permission-service.ts`](../../apps/electron/src/main/lib/agent-permission-service.ts) | 工具权限检查、权限模式管理 |
| 用户交互 | [`agent-ask-user-service.ts`](../../apps/electron/src/main/lib/agent-ask-user-service.ts) | AskUser 请求处理 |
| 工作区管理 | [`agent-workspace-manager.ts`](../../apps/electron/src/main/lib/agent-workspace-manager.ts) | 工作区 CRUD、MCP/Skills 配置 |
| 事件总线 | [`agent-event-bus.ts`](../../apps/electron/src/main/lib/agent-event-bus.ts) | Agent 事件发布/订阅 |
| 输入校验 | [`agent-tool-input-validator.ts`](../../apps/electron/src/main/lib/agent-tool-input-validator.ts) | 工具调用参数校验 |
| Token 估算 | [`agent-tool-token-estimator.ts`](../../apps/electron/src/main/lib/agent-tool-token-estimator.ts) | Token 用量估算 |

### 集成服务

| 服务 | 文件 | 说明 |
|------|------|------|
| 飞书桥接 | [`feishu-bridge.ts`](../../apps/electron/src/main/lib/feishu-bridge.ts) | 消息同步、任务通知、OAuth 认证 |
| 飞书管理 | [`feishu-bridge-manager.ts`](../../apps/electron/src/main/lib/feishu-bridge-manager.ts) | 桥接生命周期管理 |
| 飞书卡片 | [`feishu/`](../../apps/electron/src/main/lib/feishu/) | card-renderer、card-stream、run-coordinator、scoped-queue |
| 钉钉 | [`dingtalk-bridge.ts`](../../apps/electron/src/main/lib/dingtalk-bridge.ts) | 钉钉消息集成 |
| 微信 | [`wechat-bridge.ts`](../../apps/electron/src/main/lib/wechat-bridge.ts) | 微信消息集成 |
| 记忆服务 | [`memory-service.ts`](../../apps/electron/src/main/lib/memory-service.ts) | 跨会话记忆存储与检索 |

## 核心数据流

```
Renderer (window.electronAPI.xxx)
    │
    ▼
ipc.ts (ipcMain.handle)
    │
    ├─ Chat 请求 → chat-service.ts
    │   └─ provider-registry.getAdapter() → SSE Stream → webContents.send()
    │
    ├─ Agent 请求 → agent-service.ts → agent-orchestrator.ts
    │   └─ sdk.query() → SDKMessage 流 → convertSDKMessage() → webContents.send()
    │
    └─ 配置请求 → channel-manager / settings-service / ...
        └─ ~/.proma/ 文件读写 → 返回结果
```

---

## IPC 通信四层链路（Preload 桥接层）

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ ① shared/ 类型定义                                               │
 │   IPC_CHANNELS, CHAT_IPC_CHANNELS, AGENT_IPC_CHANNELS ...         │
 │   Request/Response 类型接口                                       │
 └────────────────────────────┬─────────────────────────────────────┘
                              │ 被 ②③④ 三重引用
 ┌────────────────────────────▼─────────────────────────────────────┐
 │ ② main/ipc.ts (主进程)                                           │
 │   ipcMain.handle(CHAT_IPC_CHANNELS.SEND_MESSAGE, async (e, req)   │
 │     => chatService.sendMessage(req))                               │
 └────────────────────────────┬─────────────────────────────────────┘
                              │ IPC 通道
 ┌────────────────────────────▼─────────────────────────────────────┐
 │ ③ preload/index.ts (桥接)                                        │
 │   contextBridge.exposeInMainWorld('electronAPI', {                │
 │     sendMessage: (req: SendMessageRequest) =>                     │
 │       ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEND_MESSAGE, req),    │
 │   })                                                              │
 └────────────────────────────┬─────────────────────────────────────┘
                              │ contextBridge
 ┌────────────────────────────▼─────────────────────────────────────┐
 │ ④ renderer/ (渲染进程)                                           │
 │   const result = await window.electronAPI.sendMessage(req);       │
 │   // 类型安全，IDE 自动补全                                       │
 └──────────────────────────────────────────────────────────────────┘
```

### Preload 暴露的 API 分组

| API 分组 | 示例方法 | 对应 IPC 通道组 |
|----------|----------|-----------------|
| **运行时** | `getRuntimeInfo()`, `checkGit()` | `IPC_CHANNELS` |
| **Chat** | `sendMessage()`, `stopGeneration()` | `CHAT_IPC_CHANNELS` |
| **Agent** | `sendAgentInput()`, `stopAgent()` | `AGENT_IPC_CHANNELS` |
| **渠道** | `addChannel()`, `testConnection()` | `CHANNEL_IPC_CHANNELS` |
| **对话** | `getConversations()`, `deleteConversation()` | `CONVERSATION_IPC_CHANNELS` |
| **Agent 会话** | `getAgentSessions()`, `deleteSession()` | `AGENT_SESSION_IPC_CHANNELS` |
| **设置** | `getSettings()`, `updateSettings()` | `SETTINGS_IPC_CHANNELS` |
| **文件** | `openFileDialog()`, `readFile()` | `FILE_IPC_CHANNELS` |
| **飞书** | `connectFeishu()`, `syncMessages()` | `FEISHU_IPC_CHANNELS` |
| **代理** | `getProxySettings()`, `setProxy()` | `PROXY_IPC_CHANNELS` |
| **更新** | `checkForUpdates()`, `installUpdate()` | `UPDATER_IPC_CHANNELS` |

### 核心约束

- **Preload 不能直接访问 Node.js API**（安全隔离）
- **所有通信必须通过 `ipcRenderer.invoke` / `ipcRenderer.on`**
- **`contextBridge` 确保渲染进程无法直接访问 `require`**
- **类型安全由 `@proma/shared` 的类型定义保障**

---

<p align="center">
<b>⬇ 下游</b>: <a href="./08-electron-renderer.md">08-electron-renderer</a> ·
<a href="./10-voice-dictation-ipc.md">10-voice-dictation-ipc</a>
</p>
