# @proma/ui

共享 React UI 组件库。为 Chat 和 Agent 模式的 Markdown 渲染提供语法高亮代码块、Mermaid 图表渲染和流式文本平滑动画。

## 架构图

```mermaid
flowchart TB
    entry["index.ts — 主入口<br/>CodeBlock / MermaidBlock / useSmoothStream"]

    %% 三大导出
    subgraph components["React 组件"]
        code["CodeBlock.tsx<br/>Shiki 代码高亮<br/>逐行 Token 渲染<br/>节流 80ms / 复制按钮"]
        mermaid_block["MermaidBlock.tsx<br/>beautiful-mermaid 优先<br/>mermaid 官方回退<br/>防抖 350ms / 缩放控制<br/>主题自适应"]
    end

    subgraph hooks_core["React Hooks"]
        smooth["useSmoothStream.ts<br/>流式文本打字机效果<br/>Intl.Segmenter 字素拆分<br/>rAF 驱动 / 10 语言支持"]
    end

    %% 外部依赖
    core["@proma/core<br/>highlightToTokens()<br/>onHighlighterReady()"]
    bm["beautiful-mermaid<br/>美化渲染"]
    mermaid_lib["mermaid<br/>官方渲染 (回退)"]

    entry --> code
    entry --> mermaid_block
    entry --> smooth

    core -->|"高亮调用"| code
    bm -->|"优先引擎"| mermaid_block
    mermaid_lib -->|"回退引擎"| mermaid_block
```

## 数据流向图

```mermaid
flowchart LR
    %% Markdown 渲染 → 自定义组件
    md["React Markdown<br/>解析 LLM 响应"] -->|"pre > code"| code["CodeBlock<br/>语法高亮代码块"]
    md -->|"code.mermaid"| mmd["MermaidBlock<br/>图表渲染"]
    md -->|"text node"| smooth["useSmoothStream<br/>平滑打字机"]

    %% 组件 → 外部依赖
    code -->|"highlightToTokens()"| shiki["@proma/core<br/>Shiki 高亮服务"]
    mmd -->|"1. 优先"| bm["beautiful-mermaid"]
    mmd -->|"2. 回退"| mermaid_off["mermaid"]
```

## 关键时序图

```mermaid
sequenceDiagram
    participant Stream as 流式文本推送
    participant Hook as useSmoothStream
    participant Seg as Intl.Segmenter
    participant rAF as requestAnimationFrame
    participant DOM as React DOM

    Note over Stream,DOM: 流式输出的平滑打字机效果

    Stream->>Hook: content 更新（检测 startsWith 提取增量）
    Hook->>Seg: 按字素拆分增量字符
    Seg-->>Hook: 字符追加到队列

    alt 流式进行中
        Hook->>rAF: 启动 rAF 循环
        loop 每帧
            rAF->>Hook: 回调
            Hook->>DOM: 取 queue.length / 8 字符 → setState
        end
    else 流式结束
        Hook->>rAF: 加速排空（queue.length / 4）
        loop 每帧
            rAF->>Hook: 回调
            Hook->>DOM: setState(displayedContent)
        end
    end
    Hook->>DOM: 安全网——同步最终剩余内容
```

## 重要代码文件导航

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口，导出 CodeBlock、MermaidBlock、useSmoothStream |
| `src/code-block/CodeBlock.tsx` | Shiki 语法高亮代码块组件：逐行 Token 渲染、节流 80ms、异步初始化兜底、复制按钮 |
| `src/mermaid-block/MermaidBlock.tsx` | Mermaid 图表组件：beautiful-mermaid 优先 + 官方 mermaid 回退、防抖 350ms、防竞态 generationRef、缩放 0.25-3.0、MutationObserver 主题监听 |
| `src/hooks/useSmoothStream.ts` | 流式文本平滑 Hook：Intl.Segmenter 字素拆分（10 语言）、rAF 驱动、动态每帧输出量（流式中 /8、结束后 /4）、安全网直接同步 |
