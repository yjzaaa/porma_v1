# 语音模块 — Voice Dictation

基于状态机的语音听写模块，支持免提模式和 VAD（语音活动检测）。

## 架构图

```mermaid
flowchart TB
    subgraph shared["【共享层】shared/ — 契约与基础设施"]
        shared_bus["bus/ — 领域事件总线<br/>VoiceDomainEventBus / VoiceAsrTransportBus"]
        shared_types["types/ — 共享契约<br/>asr / panel / intelligence / ipc"]
        shared_utils["utils/ — 纯工具<br/>voice-text / pcm / auto-send"]
    end

    subgraph asr["【第 7 层】asr/ — ASR Provider 实现层"]
        factory["factory.ts — 工厂模式创建 Provider"]
        webspeech["providers/webspeech/index.ts — Web Speech API<br/>浏览器内置识别"]
        doubao["providers/doubao/ — 豆包 ASR Facade<br/>audio / transport / context"]
    end

    subgraph core["core/ — 核心逻辑层"]
        subgraph runtime["【第 2 层】runtime/ — 运行时"]
            sm["StateMachine.ts — 6 状态 FSM<br/>合法转换守卫"]
            hub["AudioHub.ts — 麦克风 PCM 采集<br/>单例 + 3 秒环形缓冲"]
            vad["VADDetector.ts — 语音活动检测"]
            sess["VoiceRecordingSession.ts — 单轮录音会话领域对象<br/>生命周期 / 收尾等待"]
            asr_session["Session.ts — 底层 ASR 会话桥接<br/>VAD 静音检测 + Provider 事件转发"]
        end

        subgraph intelligence["【第 3 层】intelligence/ — 智能决策"]
            monitor["AgentStateMonitor.ts — Agent 状态监听<br/>循环状态检测"]
            asr_factory["VoiceASRResultFactory.ts — ASR 结果归一化"]
            deduper["VoiceSendDeduplicator.ts — 重复发送保护"]
            policy["VoiceSpeechDecisionPolicy.ts — 语音完整性 + 发送策略领域服务"]
        end

        subgraph asr_shared["【第 7 层】asr/shared/ — ASR 共享规则"]
            completion["completion.ts — 完整性启发式规则"]
        end

        subgraph modules["【第 4 层】modules/ — 业务模块"]
            agent_mod["VoiceAgentModule.ts — Agent 状态桥接"]
            decision["VoiceDecisionModule.ts — 决策模块"]
            command["VoiceCommandExecutionModule.ts — 命令执行分发"]
            action["VoiceActionHandlerModule.ts — 动作处理"]
            capture["VoiceCaptureModule.ts — 语音采集（事件驱动）"]
            state["VoiceRuntimeStateModule.ts — 运行时投影"]
            projection_store["VoiceRuntimeProjectionStore.ts — 投影快照存储"]
        end

        subgraph orchestrator["【第 5 层】orchestrator/ — 编排层"]
            orch_facade["Orchestrator.ts — 外观层<br/>创建模块 / 订阅桥接"]
        end
    end

    subgraph hooks["【第 4 层】hooks/ — 业务层（React Hook）"]
        hook["useVoiceOrchestrator.ts<br/>唯一 IPC 交互层<br/>桥接 Jotai + 注入回调 + 生命周期管理"]
    end

    subgraph ui["【表示层】ui/ — 表示层"]
        panel["VoiceFloatingPanel.tsx<br/>纯 UI 渲染"]
    end

    hooks -->|"创建并注入"| orch_facade
    hooks -->|"订阅"| JotaiAtoms["Jotai Agent Atoms"]
    hooks -->|"处理IPC"| MainProcess["Electron 主进程"]
    ui -->|"使用"| hook

    %% 外部依赖
    Jotai["Jotai Agent Atoms"]
    hub -->|"getUserMedia"| Browser["浏览器 Media API"]
    doubao -->|"使用 shared/bus"| shared_bus
    shared_bus -->|"IPC"| MainProcess
    webspeech -->|"SpeechRecognition"| Browser

    %% 依赖关系
    core --> shared
    asr --> shared
    sess --> asr_session
    asr_session --> asr
    sess --> shared_utils
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
    orch_facade --> shared_bus
    capture --> shared_bus
    panel --> hook
    hook --> orch_facade
    panel --> shared_types
    panel --> shared_utils
```

## 数据流向图

```mermaid
flowchart LR
    mic["🎤 麦克风"] -->|"getUserMedia<br/>Float32"| hub["AudioHub<br/>ScriptProcessor → PCM 帧"]
    hub -->|"PCM 帧广播"| session["VoiceRecordingSession<br/>单轮录音会话领域对象"]
    session -->|"session.*"| runtime["VoiceRuntimeStateModule<br/>单一 projection"]
    session -->|"decision.*"| decision["VoiceDecisionModule<br/>ASR → 决策"]
    decision -->|"action.*"| action["VoiceActionHandlerModule<br/>发送/取消/停止"]
    action -->|"command.*"| capture["VoiceCaptureModule<br/>录音会话管理"]
    action -->|"command.stop_agent"| orch["Orchestrator<br/>IPC 桥接 + 模块装配"]
    orch -->|"ipcBridge"| hook["useVoiceOrchestrator<br/>唯一 IPC 交互层"]
    hook -->|"window.electronAPI"| commit["Main Process"]
    runtime -->|"UIState"| ui["VoiceFloatingPanel<br/>React setState"]
    runtime -->|"autoSendRequested"| send["ui-events → Hook"]
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
    participant Policy as VoiceSpeechDecisionPolicy

    Note over Jotai,Policy: Agent 状态同步到语音决策模块

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

    Policy->>Monitor: getCurrentContext()
    Monitor->>Policy: 返回 VoiceAgentContext
    Note over Policy: loopState: PRE_USER_INPUT<br/>canAcceptInput: true<br/>isBusy: false

    Policy->>Policy: makeDecision()
    Note over Policy: 判断是否发送语音
```

### 命令执行与 IPC 桥接

```mermaid
sequenceDiagram
    participant Action as VoiceActionHandlerModule
    participant Bus as VoiceDomainEventBus
    participant Capture as VoiceCaptureModule
    participant Orch as Orchestrator
    participant Hook as useVoiceOrchestrator
    participant Main as Electron Main

    Action->>Bus: emit(command.stopRecording)
    Bus->>Capture: stopRecording()

    Action->>Bus: emit(command.cancelRecording)
    Bus->>Capture: cancelSession()

    Action->>Bus: emit(command.stopAgent)
    Bus->>Orch: 事件桥接
    Orch->>Hook: ipcBridge.stopAgent(sessionId)
    Hook->>Main: window.electronAPI.stopAgent(sessionId)
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
- **被动更新**：`AgentStateMonitor` 被动接收更新，不主动轮询，并输出 `VoiceAgentContext` 只读快照
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

### Capture 模块时间轴

```mermaid
flowchart LR
    Orch["Orchestrator"] -->|"emit(command.toggleHandsfree)"| Capture["VoiceCaptureModule"]
    Capture -->|"start()"| Hub["AudioHub"]
    Hub -->|"PCM 帧订阅建立"| VAD["VADDetector"]
    VAD -->|"检测到语音开始"| Sess["Session"]
    Sess -->|"start()"| ASR["ASR Provider"]
    Capture -->|"emit(session.started)"| Runtime["VoiceRuntimeStateModule"]

    Hub -->|"PCM 帧"| Capture
    Capture -->|"process(frame)"| VAD
    Hub -->|"pushAudio(frame)"| Sess
    Sess -->|"pushAudio(frame)"| ASR
    ASR -->|"onEvent(transcript / volume / metadata)"| Sess
    Sess -->|"session.* 事件"| Capture
    Capture -->|"投影 UI 状态"| Runtime

    Sess -->|"stop()"| ASR
    ASR -->|"最终文本"| Sess
    Sess -->|"complete(text)"| Capture
    Capture -->|"emit(session.complete)"| Runtime

    Note["Capture 模块负责<br/>采集 → 判定 → 启动会话 → 推送结果 → 结束会话"]
    Note -.-> Capture
```

## 文件职责导航

| 文件 | 职责 |
|------|------|
| `shared/bus/AbstractTypedEventBus.ts` | 通用 typed event bus 基类，统一 `on / emit / clear` 形状 |
| `shared/bus/VoiceDomainEventBus.ts` | 语音领域总线：连接采集、决策、动作、UI 桥接命令 |
| `shared/bus/VoiceAsrTransportBus.ts` | ASR 传输总线：Provider ↔ 主进程的请求/响应通道 |
| `shared/bus/SessionEventBus.ts` | 会话事件总线：Session 内部事件分发 |
| `shared/types/asr.ts` | ASR Provider 接口、事件映射、事件桥接 helper |
| `shared/types/panel.ts` | 面板状态、PCM 帧、Session/UI 通信接口 |
| `shared/types/intelligence.ts` | ASR 结果、AgentContext、VoiceAgentContext、Decision、LogContext 共享契约 |
| `shared/types/voice-dictation-ipc.ts` | hook 层注入的 IPC 回调契约 |
| `shared/utils/voice-text.ts` | 语音文本值对象：归一化、标点、未完成表达判断 |
| `shared/utils/pcm.ts` | PCM 采样率转换、缓冲合并、分片 |
| `shared/utils/auto-send.ts` | 语音文本自动发送判断（always / smart / AI） |
| `core/state/VoiceStateMachine.ts` | 6 状态有限状态机，严格守卫合法转换 |
| `core/state/VoiceRuntimeProjection.ts` | 运行时投影快照，统一承载 UI/上下文写入 |
| `core/state/VoiceRuntimeProjectionStore.ts` | 投影快照存储：统一更新、读取和上下文构造 |
| `core/runtime/AudioHub.ts` | 麦克风 PCM 采集单例，3 秒环形缓冲 |
| `core/runtime/VoiceRecordingSession.ts` | 单轮录音会话领域对象：状态、收尾等待、停止/取消 |
| `core/runtime/Session.ts` | 底层 ASR 会话桥接，内置 VAD 事件转发 |
| `asr/shared/completion.ts` | ASR 文本完整性共享规则：WebSpeech 提升 / 统一判定 |
| `core/intelligence/VoiceASRResultFactory.ts` | ASR 结果工厂：归一化 Provider 元数据 |
| `core/intelligence/VoiceSendDeduplicator.ts` | 发送去重器：短时重复文本保护 |
| `core/intelligence/VoiceSpeechDecisionPolicy.ts` | 语音决策领域服务：语音完整性判断 + 发送策略 |
| `core/orchestrator/Orchestrator.ts` | 外观层：创建模块、桥接事件、接收 hook 注入 IPC |
| `core/intelligence/AgentStateMonitor.ts` | Agent 状态监听器：循环状态检测与只读快照输出 |
| `core/modules/VoiceAgentModule.ts` | Agent 状态桥接模块：维护 Agent 会话 ID，提供 Agent 上下文 |
| `core/modules/VoiceDecisionModule.ts` | 决策模块：ASR 结果 → 决策事件 |
| `core/modules/VoiceCommandExecutionModule.ts` | 决策动作分发：根据发送策略分发动作事件 |
| `core/modules/VoiceActionHandlerModule.ts` | 动作处理模块：执行发送文本、处理即时指令、发布停止命令 |
| `core/modules/VoiceCaptureModule.ts` | 语音采集模块：管理麦克风采集、VAD、录音会话生命周期 |
| `hooks/useVoiceOrchestrator.ts` | 业务层 Hook：唯一 IPC 交互层，桥接 Jotai 与 Orchestrator |
| `ui/VoiceFloatingPanel.tsx` | 纯 UI 渲染组件：通过 Hook 获取状态，只负责渲染 |
| `asr/index.ts` | ASR 目录入口，汇总 provider 与共享类型 |
| `asr/factory.ts` | ASR Provider 工厂函数 |
| `asr/providers/webspeech/index.ts` | Web Speech API 实现，浏览器内置语音识别（零 IPC） |
| `asr/providers/doubao/index.ts` | 豆包 ASR 门面，组合 audio / transport / context |
| `asr/providers/doubao/audio.ts` | PCM 缓冲、分片、发送层 |
| `asr/providers/doubao/transport.ts` | 主进程桥接层，处理 start / state / transcript |
| `asr/providers/doubao/context.ts` | 豆包音频/传输共享上下文 |

## 核心设计原则

1. **单次录音单 Session** — 每轮录音创建一个独立的 Session 实例，不跨轮泄漏状态
2. **AudioHub 单例** — 整个应用只有一个 `getUserMedia` 调用，VAD 和 Session 通过 `subscribe()` 接收 PCM 帧
3. **FSM 严格守卫** — 每个状态转换都经过 `VALID_TRANSITIONS` 表校验，拒绝非法跳转
4. **Hook 业务隔离** — 业务逻辑封装在 `useVoiceOrchestrator` Hook 中，UI 组件只做纯渲染
5. **Orchestrator 中控** — 负责模块装配、事件桥接和生命周期管理，不直接承载业务规则
6. **单一投影写入** — `VoiceRuntimeStateModule` 通过 `VoiceRuntimeProjection` 统一管理 UI/上下文写入
7. **静音检测与自动重连** — 免提模式下 VAD 检测到语音自动启动录音，完成后 2 秒自动回归 listening 状态
