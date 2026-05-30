# @proma/shared

共享类型、IPC 通道常量、配置和工具函数库。零运行时依赖，仅 TypeScript 类型和常量。

## 架构图

```mermaid
flowchart TB
    %% 入口聚合层
    entry["index.ts — 主入口<br/>聚合导出"]

    %% 四大模块
    subgraph types["types/ (14 个文件)"]
        t_agent["agent.ts — Agent/SDK 类型<br/>AgentEvent / SessionMeta / MCP / Skills"]
        t_chat["chat.ts — Chat 类型<br/>消息 / 会话 / 附件 / 流式事件"]
        t_channel["channel.ts — 渠道类型<br/>Provider 枚举 / 默认 URL"]
        t_runtime["runtime.ts — 运行时类型<br/>平台检测 / Git/Bun/Node 状态"]
        t_feishu["feishu.ts — 飞书类型<br/>多 Bot / 群聊绑定 / 桥接状态"]
        t_other["其他: dingtalk / wechat / proxy<br/>system-prompt / chat-tool / github / installer / environment"]
    end

    config["config/ — APP_NAME"]

    subgraph utils["utils/"]
        u_diff["capabilities-diff.ts<br/>diffCapabilities()"]
        u_think["thinking-signature-error.ts<br/>签名失效检测"]
    end

    constants["constants/<br/>permission-rules.ts<br/>SAFE_TOOLS / SAFE_BASH / DANGEROUS_COMMANDS"]

    %% 导出路径
    types --> entry
    config --> entry
    utils --> entry
    constants --> entry

    entry -->|"."| main_exp["@proma/shared (全量)"]
    entry -->|"./types"| types_exp["@proma/shared/types"]
    entry -->|"./config"| config_exp["@proma/shared/config"]
    entry -->|"./utils"| utils_exp["@proma/shared/utils"]
```

## 数据流向图

```mermaid
flowchart LR
    shared["@proma/shared<br/>类型 & 常量"]

    %% 编译时消费者
    shared -->|"import type"| core["@proma/core"]
    shared -->|"import type"| electron["@proma/electron"]
    shared -->|"import type"| ui["@proma/ui"]

    %% 编译时检查
    shared -->|"类型检查"| tsc["tsc --noEmit"]

    %% 运行时消费者
    shared -.->|"IPC 通道常量<br/>（运行时字符串）"| ipc_main["main/ipc.ts<br/>Handler 注册"]
    shared -.->|"IPC 通道常量"| ipc_preload["preload/index.ts<br/>contextBridge"]
    shared -->|"类型约束<br/>Jotai atoms"| renderer["renderer/atoms/"]
```

## 关键时序图

```mermaid
sequenceDiagram
    participant Types as types/agent.ts
    participant IPC as AGENT_IPC_CHANNELS
    participant Main as main/ipc.ts
    participant Preload as preload/index.ts
    participant Renderer as renderer/atoms

    Note over Types,Renderer: Agent 会话创建——类型 & IPC 通道协作

    Renderer->>Preload: window.electronAPI.agent.createSession(input)
    Preload->>Main: ipcMain.handle(CREATE_SESSION)
    Note over Main: AgentSendInput 类型约束入参
    Main-->>Preload: AgentSessionMeta
    Preload-->>Renderer: AgentSessionMeta
    Note over Renderer: agent-atoms.ts 更新状态
```

## 重要代码文件导航

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口，聚合导出 types/config/utils/constants |
| `src/types/index.ts` | 类型汇总导出，含内联 `Workspace` 接口定义 |
| `src/types/agent.ts` | Agent/SDK 类型（~1472 行，最大文件）：AgentEvent 联合、SessionMeta、MCP、Skills、权限、IPC 通道 |
| `src/types/chat.ts` | Chat 模式类型：消息、会话、附件、流式事件、30+ IPC 通道 |
| `src/types/channel.ts` | AI 渠道类型：Provider 枚举、默认 URL、Agent 兼容列表 |
| `src/types/runtime.ts` | 运行时检测类型：平台/架构、Git/Bun/Node 状态、文件变更、截图限制 |
| `src/types/agent-provider.ts` | AgentProviderAdapter 接口：query/abort/dispose/setPermissionMode |
| `src/types/feishu.ts` | 飞书集成类型：多 Bot 配置、群聊绑定、桥接状态、25+ IPC 通道 |
| `src/types/dingtalk.ts` | 钉钉集成类型：多 Bot 配置、桥接状态、15 个 IPC 通道 |
| `src/types/wechat.ts` | 微信 iLink 集成类型：凭证、桥接状态机、消息协议 |
| `src/types/system-prompt.ts` | 系统提示词类型 + `BUILTIN_DEFAULT_PROMPT`（107 行中文） |
| `src/types/chat-tool.ts` | Chat 工具函数调用类型：HTTP 执行器、工具元数据、凭证 |
| `src/types/proxy.ts` | 代理配置类型：手动/系统模式 |
| `src/types/environment.ts` | 环境检查结果类型 |
| `src/types/installer.ts` | 第三方安装器类型（Windows Git/Node 一键安装） |
| `src/types/github.ts` | GitHub Release API 类型 |
| `src/utils/capabilities-diff.ts` | `diffCapabilities()`：比较两个 WorkspaceCapabilities，返回变更列表 |
| `src/utils/capabilities-diff.test.ts` | capabilities-diff 的 bun:test 单元测试 |
| `src/utils/thinking-signature-error.ts` | 思考签名失效错误检测与格式化（模型切换场景） |
| `src/config/index.ts` | `APP_NAME = 'Proma'` |
| `src/constants/permission-rules.ts` | Agent 权限规则：SAFE_TOOLS、SAFE_BASH_PATTERNS、DANGEROUS_COMMANDS |
