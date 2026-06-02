# 语音模块 — Voice Dictation

当前语音模块已从“单体 Orchestrator 编排”演进为“**事件总线 + 模块发布/订阅**”架构。  
`core/orchestrator/Orchestrator.ts` 仅作为 Facade，对外保持 API，不再承载业务流程。

## 架构图（模块关系）

```mermaid
flowchart TB
    subgraph ui["UI 层"]
        panel["ui/VoiceFloatingPanel.tsx<br/>订阅 UIState，发布外部命令"]
    end

    subgraph facade["Facade 层"]
        orch["core/orchestrator/Orchestrator.ts<br/>外观层：装配模块 + 发布 command.*"]
    end

    subgraph domain["领域模块（发布/订阅）"]
        bus["core/bus/VoiceDomainEventBus.ts<br/>统一事件总线（typed events）"]
        capture["core/modules/VoiceCaptureModule.ts<br/>采集 + VAD + Session 生命周期"]
        decision["core/modules/VoiceDecisionModule.ts<br/>转写智能决策"]
        command["core/modules/VoiceCommandExecutionModule.ts<br/>动作分发（decision.* -> action.*）"]
        action["core/modules/VoiceActionHandlerModule.ts<br/>动作处理（订阅 action.* 执行副作用）"]
        state["core/modules/VoiceRuntimeStateModule.ts<br/>状态投影（唯一写入口）"]
        agent["core/modules/VoiceAgentModule.ts<br/>Agent 上下文桥接"]
    end

    subgraph runtime["运行时能力"]
        audio["core/runtime/AudioHub.ts"]
        vad["core/runtime/VADDetector.ts"]
        session["core/runtime/Session.ts"]
        fsm["core/state/VoiceStateMachine.ts"]
        queue["core/state/StateTransitionQueue.ts"]
        asr["asr/factory.ts + asr/*Provider.ts"]
    end

    panel --> orch
    orch --> bus

    bus <--> capture
    bus <--> decision
    bus <--> command
    bus <--> action
    bus <--> state
    bus <--> agent

    capture --> audio
    capture --> vad
    capture --> session
    capture --> asr

    state --> fsm
    state --> queue
```

## 数据流向图（事件驱动）

```mermaid
flowchart LR
    U["VoiceFloatingPanel"] -->|"toggleHandsfree / stopRecording / updateAgentState"| F["Orchestrator Facade"]
    F -->|"emit command.*"| B["VoiceDomainEventBus"]

    B -->|"command.toggle_handsfree"| C["VoiceCaptureModule"]
    C -->|"handsfree.enabled / handsfree.disabled"| B

    C -->|"session.started / session.volume / session.transcript / session.complete / session.error"| B
    B -->|"session.transcript"| D["VoiceDecisionModule"]
    D -->|"decision.feedback / decision.execute"| B

    B -->|"decision.execute"| X["VoiceCommandExecutionModule"]
    X -->|"action.*"| H["VoiceActionHandlerModule"]
    H -->|"emitVoiceAutoSendRequested"| GS["GlobalShortcuts"]
    GS -->|"sendAgentMessage"| Agent["Agent Runtime"]

    B -->|"session.* + decision.feedback + handsfree.*"| S["VoiceRuntimeStateModule"]
    S -->|"VoiceUIState"| U

    B -->|"command.update_agent_state / command.set_agent_session_id"| A["VoiceAgentModule"]
    A -->|"AgentContext（供决策模块读取）"| D
```

## 关键时序图（免提到自动发送）

```mermaid
sequenceDiagram
    participant UI as VoiceFloatingPanel
    participant F as Orchestrator(Facade)
    participant B as VoiceDomainEventBus
    participant C as VoiceCaptureModule
    participant D as VoiceDecisionModule
    participant X as VoiceCommandExecutionModule
    participant H as VoiceActionHandlerModule
    participant S as VoiceRuntimeStateModule

    UI->>F: toggleHandsfree(settings)
    F->>B: command.toggle_handsfree
    B->>C: consume command.toggle_handsfree
    C->>B: handsfree.enabled
    B->>S: consume handsfree.enabled -> transition(listening)

    C->>B: session.started
    B->>S: transition(recording)

    loop 录音中
      C->>B: session.transcript(text,isFinal,provider)
      B->>D: consume session.transcript
      D->>B: decision.feedback
      B->>S: 更新 message / 状态投影
      alt shouldSend
        D->>B: decision.execute
        B->>X: consume decision.execute
        X->>B: emit action.*
        B->>H: consume action.*
      end
    end

    C->>B: session.complete
    B->>S: transition(stopped/listening)
```

## 重要文件导航（按职责）

| 文件 | 职责 |
|---|---|
| `core/orchestrator/Orchestrator.ts` | Facade：对外 API、模块装配、生命周期管理 |
| `core/bus/VoiceDomainEventBus.ts` | 统一领域事件契约与发布/订阅实现 |
| `core/bus/SessionEventBus.ts` | 单轮录音会话事件总线 |
| `core/modules/VoiceCaptureModule.ts` | 采集/VAD/Session 链路，发布 `session.*` |
| `core/modules/VoiceDecisionModule.ts` | 消费 `session.transcript`，发布 `decision.*` |
| `core/modules/VoiceCommandExecutionModule.ts` | 消费 `decision.execute`，发布 `action.*` |
| `core/modules/VoiceActionHandlerModule.ts` | 消费 `action.*`，执行发送/打断/状态迁移 |
| `core/modules/VoiceRuntimeStateModule.ts` | 状态机投影（唯一状态写入口） |
| `core/modules/VoiceAgentModule.ts` | Agent 状态桥接，提供 `AgentContext` |
| `core/runtime/AudioHub.ts` | 麦克风 PCM 采集与帧广播 |
| `core/runtime/VADDetector.ts` | 自适应语音活动检测 |
| `core/runtime/Session.ts` | 单轮录音会话生命周期 |
| `core/state/VoiceStateMachine.ts` | 语音状态机 |
| `core/state/StateTransitionQueue.ts` | 状态迁移排队执行 |
| `asr/factory.ts` | ASR Provider 工厂 |
| `asr/doubao.ts` | 豆包 ASR Provider |
| `asr/webspeech.ts` | WebSpeech Provider |
| `ui-events/voice-dictation-events.ts` | UI 侧全局事件（设置变更、自动发送请求） |
| `ui-events/log-events.ts` | 日志事件发射/订阅工具 |

## 当前设计原则

1. **Facade 最小化**：Facade 只发布命令，不直接执行业务分支。  
2. **总线协作**：模块间不互相调用实现，统一经 `VoiceDomainEventBus` 协作。  
3. **状态单写口**：状态写入只在 `VoiceRuntimeStateModule`，降低竞态。  
4. **动作事件收口**：发送/打断等副作用统一由 `action.*` 事件链处理。  
5. **运行时与策略分层**：采集链路（Capture）与决策链路（Decision）解耦。  
