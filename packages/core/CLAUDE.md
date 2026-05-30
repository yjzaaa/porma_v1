# @proma/core

AI Provider 适配器层 + Shiki 代码高亮服务。纯逻辑包，不访问文件系统和网络（由外部注入 fetchFn 和 ImageAttachmentReader）。

## 架构图

```mermaid
flowchart TB
    entry["index.ts — 主入口"]

    %% Providers 层
    subgraph providers["providers/ — AI Provider 适配器系统"]
        direction TB
        registry["index.ts — adapterRegistry<br/>11 个 Provider → Adapter 映射"]
        types_p["types.ts — 核心接口<br/>ProviderAdapter / StreamEvent / ThinkingBlock"]
        anthropic["anthropic-adapter.ts<br/>Anthropic Messages API<br/>+ DeepSeek/Kimi/MiniMax 兼容"]
        openai["openai-adapter.ts<br/>OpenAI Chat Completions<br/>+ 智谱/豆包/通义千问"]
        google["google-adapter.ts<br/>Gemini Generative Language"]
        sse["sse-reader.ts<br/>通用 SSE 流读取器<br/>streamSSE() + fetchTitle()"]
        thinking["thinking-capability.ts<br/>Thinking 模式检测<br/>adaptive/manual/effort-based/none"]
        url_utils["url-utils.ts<br/>URL 规范化"]
    end

    %% Highlight 层
    subgraph highlight["highlight/ — 代码语法高亮"]
        shiki["shiki-service.ts<br/>Shiki 单例高亮器<br/>highlightCode / highlightCodeSync / highlightToTokens"]
        lang_detect["language-detector.ts<br/>highlight.js 语言检测<br/>无标记代码块回退"]
    end

    %% 内部依赖
    registry --> anthropic
    registry --> openai
    registry --> google
    anthropic --> types_p
    openai --> types_p
    google --> types_p
    sse --> types_p
    thinking --> anthropic
    url_utils --> anthropic
    shiki --> lang_detect

    %% 对外导出
    entry --> registry
    entry --> shiki
```

## 数据流向图

```mermaid
flowchart LR
    %% 调用链
    chat_svc["chat-service.ts<br/>Electron 主进程"] -->|"getAdapter()"| registry["provider-registry<br/>查找适配器"]
    registry -->|"buildStreamRequest()"| adapter["ProviderAdapter<br/>构建 HTTP 请求"]
    adapter -->|"ProviderRequest"| fetch_fn["fetch()<br/>外部注入"]
    fetch_fn -->|"Response.body"| sse["sse-reader.ts<br/>streamSSE()"]
    sse -->|"parseSSELine()"| adapter
    adapter -->|"StreamEvent[]"| sse
    sse -->|"累积 content/<br/>reasoning/toolCalls"| chat_svc

    %% UI 消费者
    chat_svc -.->|"文本流"| ui["React 组件<br/>CodeBlock / MermaidBlock"]
```

## 关键时序图

```mermaid
sequenceDiagram
    participant Chat as chat-service.ts
    participant Registry as provider-registry
    participant Adapter as AnthropicAdapter
    participant SSE as sse-reader.ts

    Note over Chat,SSE: Chat 流式消息——完整调用链路

    Chat->>Registry: getAdapter('anthropic')
    Registry-->>Chat: AnthropicAdapter 实例
    Chat->>Adapter: buildStreamRequest(messages, model, tools)
    Adapter-->>Chat: ProviderRequest {url, headers, body}
    Chat->>SSE: streamSSE(request, adapter, signal)

    loop 每个 SSE 数据块
        SSE->>Adapter: parseSSELine(jsonLine)
        Adapter-->>SSE: StreamEvent[] (chunk / reasoning / tool_call_start / tool_call_delta)
        SSE-->>Chat: yield StreamEvent
    end

    SSE-->>Chat: streamEnd(content, reasoning, thinkingBlocks, toolCalls, stopReason)
```

## 重要代码文件导航

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口，聚合导出 providers + highlight |
| `src/providers/types.ts` | 核心接口：`ProviderAdapter`、`StreamEvent`（9 种变体）、`ToolDefinition`、`ThinkingBlock` |
| `src/providers/index.ts` | Provider 注册表，11 个渠道 → 适配器映射，`getAdapter()` 查找函数 |
| `src/providers/anthropic-adapter.ts` | Anthropic 协议适配器（~497 行）：5 种 thinking 模式、3 种 URL 策略、Kimi Coding 特殊 Header |
| `src/providers/openai-adapter.ts` | OpenAI 协议适配器（~291 行）：流式 tool_calls 关联、reasoning_content、图片 data: URI |
| `src/providers/google-adapter.ts` | Gemini 适配器（~316 行）：角色映射、thought 标记、API Key URL 参数 |
| `src/providers/sse-reader.ts` | 通用 SSE 流读取器（~263 行）：`streamSSE()` 流式解析 + `fetchTitle()` 标题生成 |
| `src/providers/thinking-capability.ts` | Thinking 模式检测（~109 行）：根据 modelId 返回 adaptive/manual/effort-based/none |
| `src/providers/url-utils.ts` | URL 规范化：`normalizeAnthropicBaseUrl`、`normalizeBaseUrl` 等 4 个函数 |
| `src/highlight/shiki-service.ts` | Shiki 高亮器单例（~276 行）：`highlightCode`（异步）、`highlightCodeSync`（同步）、`highlightToTokens`（逐行 Token） |
| `src/highlight/language-detector.ts` | 语言检测（~97 行）：highlight.js `highlightAuto` + 置信度阈值，无语言标记的代码块回退方案 |
