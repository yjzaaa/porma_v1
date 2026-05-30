# @proma/electron

Proma Electron 桌面应用主体。集成所有内部包，提供 Chat/Agent 双模式、飞书/钉钉/微信桥接、工作区管理和完整的桌面体验。

## 架构图

```mermaid
flowchart TB
    %% 三进程架构
    subgraph main["主进程 src/main/"]
        direction TB
        ipc["ipc.ts — IPC Handler 注册中心"]
        handlers["ipc/ — 13 个 Handler 模块<br/>agent / chat / feishu / channel / settings / ..."]
        subgraph lib["lib/ — 服务层 (40+ 文件)"]
            agent["agent/ — Agent 编排<br/>orchestrator / session / permission / workspace"]
            chat_lib["chat/ — Chat 服务<br/>chat-service / chat-tool-*"]
            feishu["feishu/ — 飞书桥接 (20+ 文件)<br/>bridge / manager / card / mirror"]
            other_svc["其他: dingtalk / wechat / memory<br/>channel / conversation / runtime / updater"]
        end
    end

    subgraph preload["预加载脚本 src/preload/"]
        bridge["index.ts — contextBridge<br/>13 个 API 模块<br/>agent / chat / workspace / feishu / ..."]
    end

    subgraph renderer["渲染进程 src/renderer/"]
        react["React 18 应用<br/>App.tsx — 根组件"]
        atoms["atoms/ — Jotai 状态<br/>25+ 原子模块"]
        comps["components/ — UI 组件树<br/>app-shell / agent / chat / settings"]
        hooks_r["hooks/ — 全局监听<br/>useGlobalAgentListeners<br/>useGlobalChatListeners"]
    end

    %% 进程间通信
    lib --> handlers
    handlers --> ipc
    ipc <-->|"ipcMain.handle()<br/>webContents.send()"| bridge
    bridge <-->|"window.electronAPI"| react

    %% 渲染进程内部
    react --> atoms
    react --> comps
    react --> hooks_r
```

## 数据流向图

```mermaid
flowchart LR
    %% 完整数据路径
    user["用户输入"] --> input["ChatInput / AgentInput<br/>React 组件"]
    input --> ipc_call["window.electronAPI.*<br/>IPC 调用"]
    ipc_call --> handler["ipc.ts Handler<br/>主进程处理"]
    handler --> service["chat-service.ts<br/>或 agent-orchestrator.ts"]
    service --> backend["Agent SDK<br/>或 Provider Adapter"]
    backend --> stream["流式响应<br/>webContents.send()"]
    stream --> listener["useGlobalAgentListeners<br/>useGlobalChatListeners"]
    listener --> jotai["store.set(atoms)<br/>Jotai 状态更新"]
    jotai --> rerender["React 重渲染<br/>消息列表 / 工具活动"]
    rerender --> user
```

## 关键时序图

```mermaid
sequenceDiagram
    participant User as 用户
    participant R as React 渲染进程
    participant P as contextBridge
    participant M as 主进程 ipc.ts
    participant A as agent-orchestrator.ts
    participant SDK as Claude Agent SDK

    Note over User,SDK: Agent 模式完整调用链路

    User->>R: 输入 prompt，点击发送
    R->>P: window.electronAPI.agent.send(input)
    P->>M: ipcMain.handle(AGENT_SEND)
    M->>A: query(prompt, options)

    %% SDK 调用前准备
    A->>A: 并发守卫检查
    A->>A: buildSdkEnv() 构建环境变量
    A->>A: 解析渠道 & 解密 API Key

    %% SDK 流式交互
    A->>SDK: sdk.query({prompt, options})
    loop 流式响应
        SDK-->>A: SDKMessage (text / tool_use / thinking)
        A->>A: convertSDKMessage() → AgentEvent
        A->>M: webContents.send(STREAM_EVENT)
        M->>P: IPC 事件转发
        P->>R: 触发 listener
        R->>R: applyAgentEvent() 更新状态
        R->>User: UI 渲染（消息 / 工具 / 权限请求）
    end

    %% 完成处理
    SDK-->>A: result 消息
    A->>A: 消息持久化到 JSONL
    A->>A: 自动生成会话标题
    A->>M: webContents.send(COMPLETE)
    M->>R: 完成事件
    R->>User: 显示完成状态
```

## 重要代码文件导航

### 主进程入口

| 文件 | 职责 |
|------|------|
| `src/main/index.ts` | Electron 主进程入口：单实例锁、userData 隔离、文件关联、协议注册 |
| `src/main/ipc.ts` | IPC Handler 注册中心，聚合所有 ipc/ 模块 |
| `src/main/menu.ts` | 原生菜单栏（macOS 应用菜单 + 快捷键） |
| `src/main/tray.ts` | 系统托盘（图标 + 右键菜单） |

### Agent 核心

| 文件 | 职责 |
|------|------|
| `src/main/lib/agent/agent-orchestrator.ts` | Agent 核心编排层：并发守卫、渠道查找、SDK 调用、事件流转换、自动标题 |
| `src/main/lib/agent/agent-service.ts` | Agent 服务入口：session 生命周期管理 |
| `src/main/lib/agent/agent-session-manager.ts` | Agent 会话 CRUD、JSONL 消息持久化 |
| `src/main/lib/agent/agent-prompt-builder.ts` | 系统提示词构建：动态上下文、工作区注入 |
| `src/main/lib/agent/agent-permission-service.ts` | 工具权限检查：safe/ask/allow-all 模式 |
| `src/main/lib/agent/agent-workspace-manager.ts` | 工作区管理：MCP、Skills、工作区 CRUD |
| `src/main/lib/agent/agent-event-bus.ts` | Agent 事件总线：解耦事件发布与订阅 |
| `src/main/lib/adapters/claude-agent-adapter.ts` | SDK 适配器实现，对接 `@anthropic-ai/claude-agent-sdk` |

### Chat 核心

| 文件 | 职责 |
|------|------|
| `src/main/lib/chat/chat-service.ts` | Chat 流式编排：Provider 适配器集成、消息持久化、AbortController |
| `src/main/lib/conversation/conversation-manager.ts` | 对话 CRUD、JSONL 存储、置顶、上下文分割 |

### 集成服务

| 文件 | 职责 |
|------|------|
| `src/main/lib/feishu/feishu-bridge.ts` | 飞书桥接核心 |
| `src/main/lib/feishu/feishu-bridge-manager.ts` | 飞书多 Bot 桥接管理 |
| `src/main/lib/dingtalk/dingtalk-bridge.ts` | 钉钉桥接 |
| `src/main/lib/wechat/wechat-bridge.ts` | 微信 iLink 桥接 |
| `src/main/lib/memory/memory-service.ts` | 跨会话记忆存储与检索 |
| `src/main/lib/integration/doubao-asr-service.ts` | 豆包流式语音识别 |

### 预加载脚本

| 文件 | 职责 |
|------|------|
| `src/preload/index.ts` | contextBridge 主入口，聚合所有 API 模块 |
| `src/preload/agent-sessions.ts` | Agent 会话相关 API 暴露 |
| `src/preload/chat.ts` | Chat 相关 API 暴露 |
| `src/preload/agent-workspace.ts` | 工作区 & MCP & Skills API 暴露 |

### 渲染进程

| 文件 | 职责 |
|------|------|
| `src/renderer/main.tsx` | React 根挂载 + 初始化组件（主题、更新器、Agent 监听） |
| `src/renderer/App.tsx` | 根组件：三面板布局 + Provider 层级 + 迁移/新手引导 |
| `src/renderer/atoms/agent-atoms.ts` | Agent 状态：会话列表、流式状态、权限/AskUser 队列 |
| `src/renderer/atoms/chat-atoms.ts` | Chat 状态：对话列表、流式状态、模型选择、并排模式 |
| `src/renderer/hooks/useGlobalAgentListeners.ts` | 全局 Agent IPC 监听器：永不销毁，后台会话事件不丢失 |
| `src/renderer/hooks/useGlobalChatListeners.ts` | 全局 Chat IPC 监听器 |
| `src/renderer/components/agent/AgentView.tsx` | Agent 主视图 |
| `src/renderer/components/chat/ChatView.tsx` | Chat 主视图 |
| `src/renderer/components/app-shell/AppShell.tsx` | 三面板外壳布局 |
| `src/renderer/components/settings/` | 设置面板（General/Agent/Appearance/Feishu/Proxy 等 30+ 页面） |

### 配置 & 构建

| 文件 | 职责 |
|------|------|
| `package.json` | 包配置：依赖、脚本、optionalDependencies（SDK 平台子包） |
| `electron-builder.yml` | 打包配置：ASAR、平台目标、SDK native binary 解压 |
| `vite.config.ts` | Vite 构建配置：alias、HMR 端口 |
| `tailwind.config.js` | Tailwind CSS 配置：dark mode='class' |
