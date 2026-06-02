# 语音模块 — Voice Dictation

基于状态机的语音听写模块，支持免提模式和 VAD（语音活动检测）。

## 架构图

```mermaid
flowchart TB
    subgraph types["【第 1 层】types/ — 类型定义层"]
        asr_t["asr.ts — ASRProvider 接口 + ASRCallbacks"]
        panel_t["panel.ts — 状态机类型 / PCM 帧 / Session / UIState"]
        intel_t["intelligence.ts — AgentContext<br/>AgentLoopState / Decision"]
        idx_t["index.ts — 类型重导出"]
    end

    subgraph asr["【第 7 层】asr/ — ASR Provider 实现层"]
        factory["factory.ts — 工厂模式创建 Provider"]
        webspeech["webspeech.ts — Web Speech API<br/>浏览器内置识别"]
        doubao["doubao.ts — 豆包 ASR<br/>IPC 通信 + 主进程链路"]
    end

    subgraph core["core/ — 核心逻辑层"]
        subgraph runtime["【第 2 层】runtime/ — 运行时"]
            sm["StateMachine.ts — 6 状态 FSM<br/>合法转换守卫"]
            hub["AudioHub.ts — 麦克风 PCM 采集<br/>单例 + 3 秒环形缓冲"]
            vad["VADDetector.ts — 语音活动检测"]
            sess["Session.ts — 单轮录音会话<br/>VAD 静音检测 + ASR 生命周期"]
        end

        subgraph intelligence["【第 3 层】intelligence/ — 智能决策"]
            monitor["AgentStateMonitor.ts — Agent 状态监听<br/>循环状态检测"]
            detector["UnifiedIntelligenceDetector.ts — 语音完整性 + 发送策略"]
        end

        subgraph modules["【第 4 层】modules/ — 业务模块"]
            agent_mod["VoiceAgentModule.ts — Agent 状态桥接"]
            decision["VoiceDecisionModule.ts — 决策模块"]
            command["VoiceCommandExecutionModule.ts — 命令执行分发"]
            action["VoiceActionHandlerModule.ts — 动作处理"]
            capture["VoiceCaptureModule.ts — 语音采集（注入 transportBus）"]
            state["VoiceRuntimeStateModule.ts — 运行时状态"]
        end

        subgraph orchestrator["【第 5 层】orchestrator/ — 编排层"]
            orch_facade["Orchestrator.ts — 外观层<br/>创建模块 / 发布命令"]
        end

        subgraph bus["【第 6 层】bus/ — 事件总线"]
            domain_bus["VoiceDomainEventBus.ts — 领域事件总线"]
            asr_bus["VoiceAsrTransportBus.ts — ASR 传输总线"]
        end
    end

    subgraph hooks["【第 4 层】hooks/ — 业务层（React Hook）"]
        hook["useVoiceOrchestrator.ts<br/>创建 transportBus + 处理 ASR 对外交互<br/>状态桥接 + 生命周期管理"]
    end

    subgraph ui["【表示层】ui/ — 表示层"]
        panel["VoiceFloatingPanel.tsx<br/>纯 UI 渲染"]
    end

    hooks -->|"创建并注入"| orch_facade
    hooks -->|"创建并管理"| asr_bus
    hooks -->|"订阅"| JotaiAtoms["Jotai Agent Atoms"]
    hooks -->|"处理IPC"| MainProcess["Electron 主进程"]
    ui -->|"使用"| hook

    subgraph utils["utils/ — 工具函数"]
        auto["auto-send.ts — 自动发送策略"]
        pcm["pcm.ts — PCM 采样率转换 / 分片"]
    end

    %% 外部依赖
    Jotai["Jotai Agent Atoms"]
    hub -->|"getUserMedia"| Browser["浏览器 Media API"]
    doubao -->|"使用 asr_bus"| asr_bus
    asr_bus -->|"IPC"| MainProcess
    webspeech -->|"SpeechRecognition"| Browser

    %% 依赖关系
    core --> types
    asr --> types
    asr --> utils
    sess --> asr
    sess --> utils
    sess --> hub
    decision --> intelligence
    decision --> agent_mod
    action --> state
    action --> capture
    action --> agent_mod
    command --> decision
    capture --> runtime
    agent_mod --> intelligence
    state --> sm
    orch_facade --> modules
    orch_facade --> asr_bus
    capture --> asr_bus
    panel --> hook
    hook --> orch_facade
    panel --> types
    panel --> utils
```

## 数据流向图

```mermaid
flowchart LR
    mic["🎤 麦克风"] -->|"getUserMedia<br/>Float32"| hub["AudioHub<br/>ScriptProcessor → PCM 帧"]
    hub -->|"PCM 帧广播<br/>subscribers"| session["Session<br/>VAD 检测 + ASR 推送"]
    hub -->|"PCM 帧"| vad["Orchestrator.detectSpeech<br/>免提语音活动检测"]

    session -->|"onTranscript"| orch["Orchestrator<br/>UIState 聚合"]
    vad -->|"能量阈值触发"| orch
    orch -->|"broadcast"| ui["VoiceFloatingPanel<br/>React setState"]

    session -->|"stop/complete"| commit["commitVoiceDictation IPC<br/>主进程输出处理"]
    commit -->|"result.message"| orch
    orch -->|"onAutoSend"| send["window.electronAPI<br/>sendAgentMessage"]
```

## Agent 状态同步

语音模块通过事件驱动机制实时监听 Agent 运行状态，用于智能决策何时发送语音文本。

### 状态同步链路

```mermaid
sequenceDiagram
    participant Jotai as Jotai Agent Atoms
    participant Hook as useVoiceOrchestrator
    participant Orch as Orchestrator
    participant Bus as VoiceDomainEventBus
    participant AgentMod as VoiceAgentModule
    participant Monitor as AgentStateMonitor
    participant Detector as UnifiedIntelligenceDetector

    Note over Jotai,Detector: Agent 状态同步到语音决策模块

    Jotai->>Hook: agentStreamingStatesAtom 变化
    Jotai->>Hook: currentAgentSessionIdAtom 变化
    Jotai->>Hook: appModeAtom 变化

    Hook->>Hook: syncAgentContext() 订阅触发
    Hook->>Orch: updateAgentState({...})
    Hook->>Orch: setCurrentAgentSessionId(sessionId)

    Orch->>Bus: emit(command.updateAgentState)
    Bus->>AgentMod: 事件转发
    AgentMod->>Monitor: updateAgentState(payload)

    Monitor->>Monitor: 更新 currentState
    Note over Monitor: streamingState.running<br/>streamingState.toolActivities<br/>hasError

    Detector->>Monitor: getCurrentContext()
    Monitor->>Detector: 返回 AgentContext
    Note over Detector: loopState: PRE_USER_INPUT<br/>canAcceptInput: true

    Detector->>Detector: makeIntelligentDecision()
    Note over Detector: 判断是否发送语音
```

### 状态判断逻辑

`AgentStateMonitor.detectLoopState()` 根据综合状态判断 Agent 循环状态：

| 状态条件 | 返回的循环状态 | 可接受输入 |
|---------|---------------|----------|
| `hasError === true` | `ERROR_STATE` | ✅ 是 |
| `!running && content === ''` | `PRE_USER_INPUT` | ✅ 是 |
| `running && toolActivities.length > 0` | `TOOL_EXECUTING` | ❌ 否 |
| `running` | `LLM_PROCESSING` | ❌ 否 |
| 有内容但流式结束 | `POST_PROCESSING` | ❌ 否 |

### 关键设计

- **解耦架构**：语音模块通过事件总线与 Agent 状态管理解耦
- **被动更新**：`AgentStateMonitor` 被动接收更新，不主动轮询
- **Hook 桥接**：`useVoiceOrchestrator` Hook 从 Jotai atoms 读取状态并发布事件
- **UI 纯渲染**：`VoiceFloatingPanel` 只负责渲染，业务逻辑在 Hook 中
- **实时响应**：Jotai atoms 变化立即触发 `syncAgentContext()` → 状态同步

## 状态机图

```mermaid
stateDiagram-v2
    [*] --> stopped
    stopped --> listening: enableHandsfree
    listening --> recording: VAD 检测到语音
    listening --> stopped: disableHandsfree
    
    recording --> processing: 静音超时 / 手动停止
    recording --> error: ASR 失败
    recording --> stopped: 取消
    recording --> recording: 持续录音中
    
    processing --> completed: 输出成功
    processing --> error: 输出失败
    processing --> stopped: 取消
    
    completed --> stopped: 2s 后自动回归
    completed --> listening: 免提模式 2s 后
    
    error --> stopped: 2s 后自动恢复
    error --> listening: 免提模式 2s 后
```

## 关键时序图

### 免提模式自动录音

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as VoiceFloatingPanel
    participant Orch as Orchestrator
    participant Hub as AudioHub
    participant FSM as StateMachine
    participant Sess as Session
    participant ASR as ASR Provider
    
    Note over UI,ASR: 免提模式：连续免按键操作
    
    UI->>Orch: enableHandsfree()
    Orch->>FSM: transition('listening')
    Orch->>Hub: start() — getUserMedia
    Hub-->>Orch: PCM 帧订阅
    
    loop VAD 检测
        Hub->>Orch: PCM 帧 (volume)
        Orch->>Orch: detectSpeech() — 能量阈值判断
        alt 检测到语音 (>0.02, >2s 间隔)
            Orch->>FSM: transition('recording')
            Orch->>Sess: new Session() → start()
            Sess->>ASR: start() — 启动识别
        end
    end
    
    loop 录音中
        Hub->>Sess: PCM 帧订阅
        Sess->>Sess: VAD 静音检测
        alt 静音超时 (>= vatStopTimeoutMs)
            Sess->>Sess: stop()
        end
        Sess->>ASR: PCM 数据（豆包）/ 事件（WebSpeech）
        ASR-->>Sess: onTranscript(text, isFinal)
        Sess-->>Orch: onTranscript
        Orch-->>UI: emit(UIState)
    end
    
    Sess->>Sess: completeRecording()
    Sess->>+MainProcess: commitVoiceDictation(text)
    MainProcess-->>-Sess: {message}
    Sess-->>Orch: onComplete({text, commitMessage})
    Orch->>FSM: transition('stopped')
    Orch->>UI: emit()
    Note over Orch: 2s 后自动回 listening
    Orch->>FSM: transition('listening')
    Orch->>UI: emit()
```

### 手动录音模式

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as VoiceFloatingPanel
    participant Orch as Orchestrator
    participant FSM as StateMachine
    participant Sess as Session
    participant ASR as ASR Provider
    
    Note over User,ASR: 手动模式：用户按键触发录音/停止
    
    User->>UI: 快捷键 / 按钮 push-to-talk
    UI->>Orch: stopRecording()
    Orch->>FSM: transition('processing')
    Orch->>Sess: session.stop()
    Sess->>ASR: stop() → 返回最终文本
    Sess->>Sess: completeRecording()
    Sess-->>Orch: onComplete({text, commitMessage})
    Orch->>UI: emit(UIState)
```

## 文件职责导航

| 文件 | 职责 |
|------|------|
| `types/asr.ts` | ASR Provider 接口定义（ASRProvider / ASRCallbacks / ASRProviderType） |
| `types/panel.ts` | 面板状态机类型（PanelState / DetectorState / VoiceUIState）、PCM 帧、Session/UI 通信接口 |
| `types/index.ts` | 类型重导出入口 |
| `core/StateMachine.ts` | 6 状态有限状态机，严格守卫合法转换 |
| `core/AudioHub.ts` | 麦克风 PCM 采集单例，3 秒环形缓冲，发布-订阅模式 |
| `core/Session.ts` | 单轮录音会话生命周期管理（start→stop→complete→dispose），内置 VAD 静音检测 |
| `core/Orchestrator.ts` | 总调度器：AudioHub 持有、免提开关、VAD 语音活动检测、Session 创建/销毁、UIState 广播 |
| `core/intelligence/AgentStateMonitor.ts` | Agent 状态监听器：实时监听 Agent 对话状态、精确检测循环状态、判断用户输入时机 |
| `core/intelligence/UnifiedIntelligenceDetector.ts` | 智能决策引擎：语音完整性检测 + 自动发送策略判断 |
| `core/modules/VoiceAgentModule.ts` | Agent 状态桥接模块：订阅领域事件，维护 Agent 会话 ID，提供 Agent 上下文 |
| `core/modules/VoiceDecisionModule.ts` | 决策模块：ASR 结果 → 决策事件（是否发送、发送策略） |
| `core/modules/VoiceCommandExecutionModule.ts` | 决策动作分发：根据发送策略分发到不同动作处理器 |
| `core/modules/VoiceActionHandlerModule.ts` | 动作处理模块：执行发送文本、处理即时指令、停止 Agent |
| `core/modules/VoiceCaptureModule.ts` | 语音采集模块：接受外部注入的 transportBus，管理麦克风采集、VAD 检测、录音会话生命周期 |
| `core/orchestrator/Orchestrator.ts` | 外观层（Facade）：创建各模块、发布命令到事件总线、管理生命周期、接受 transportBus 注入 |
| `core/bus/VoiceAsrTransportBus.ts` | ASR 对外交互总线：处理 Provider 与主进程间的异步请求/响应 |
| `hooks/useVoiceOrchestrator.ts` | 业务层 Hook：创建 transportBus、处理 ASR 对外交互（IPC 请求/事件）、创建和管理 Orchestrator 生命周期、桥接 Jotai Agent Atoms |
| `ui/VoiceFloatingPanel.tsx` | 纯 UI 渲染组件：通过 Hook 获取状态，只负责渲染 |
| `asr/factory.ts` | ASR Provider 工厂函数 |
| `asr/webspeech.ts` | Web Speech API 实现，浏览器内置语音识别（零 IPC） |
| `asr/doubao.ts` | 豆包 ASR 实现，通过 VoiceAsrTransportBus 与主进程通信 |
| `utils/auto-send.ts` | 语音识别文本自动发送判断（always / smart / AI 三种策略） |
| `utils/pcm.ts` | PCM 音频工具函数：采样率转换、缓冲合并、分片 |

## 核心设计原则

1. **单次录音单 Session** — 每轮录音创建一个独立的 Session 实例，不跨轮泄漏状态
2. **AudioHub 单例** — 整个应用只有一个 `getUserMedia` 调用，VAD 和 Session 通过 `subscribe()` 接收 PCM 帧
3. **FSM 严格守卫** — 每个状态转换都经过 `VALID_TRANSITIONS` 表校验，拒绝非法跳转
4. **Hook 业务隔离** — 业务逻辑封装在 `useVoiceOrchestrator` Hook 中，UI 组件只做纯渲染
5. **Orchestrator 中控** — 所有状态的变更和 UI 广播都经过 Orchestrator
6. **静音检测与自动重连** — 免提模式下 VAD 检测到语音自动启动录音，完成后 2 秒自动回归 listening 状态
