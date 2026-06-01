# 语音模块 — Voice Dictation

基于状态机的语音听写模块，支持免提模式和 VAD（语音活动检测）。

## 架构图

```mermaid
flowchart TB
    subgraph types["types/ — 类型定义层"]
        asr_t["asr.ts — ASRProvider 接口 + ASRCallbacks"]
        panel_t["panel.ts — 状态机类型 / PCM 帧 / Session / UIState"]
        idx_t["index.ts — 类型重导出"]
    end

    subgraph asr["asr/ — ASR Provider 实现层"]
        factory["factory.ts — 工厂模式创建 Provider"]
        webspeech["webspeech.ts — Web Speech API<br/>浏览器内置识别"]
        doubao["doubao.ts — 豆包 ASR<br/>IPC 通信 + 主进程链路"]
    end

    subgraph core["core/ — 核心逻辑层"]
        sm["StateMachine.ts — 6 状态 FSM<br/>合法转换守卫"]
        hub["AudioHub.ts — 麦克风 PCM 采集<br/>单例 + 3 秒环形缓冲"]
        vad_d["VADDetector.ts — 自适应语音检测<br/>噪声估计 + 挂尾保护"]
        session["Session.ts — 单轮录音会话<br/>VAD 静音检测（依赖注入）"]
        orch["Orchestrator.ts — 总调度器<br/>免提开关 / VAD / Session 管理"]
    end

    subgraph ui["ui/ — 表示层"]
        panel["VoiceFloatingPanel.tsx<br/>React Portal 浮动面板"]
    end

    subgraph utils["utils/ — 工具函数"]
        auto["auto-send.ts — 自动发送策略"]
        pcm["pcm.ts — PCM 采样率转换 / 分片"]
    end

    %% 依赖关系
    core --> types
    asr --> types
    asr --> utils
    orch --> sm
    orch --> hub
    orch --> session
    orch --> asr
    ui --> orch
    ui --> types
    ui --> utils

    %% 外部依赖
    hub -->|"getUserMedia"| Browser["浏览器 Media API"]
    doubao -->|"IPC"| MainProcess["Electron 主进程"]
    webspeech -->|"SpeechRecognition"| Browser
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
| `core/VADDetector.ts` | 自适应 VAD：噪声底噪 EMA 估计、连续帧确认、挂尾保护 |
| `core/Session.ts` | 单轮录音会话生命周期管理（start→stop→complete→dispose），通过 VADDetector.isSpeaking 做静音检测 |
| `core/Orchestrator.ts` | 总调度器：AudioHub 持有、免提开关、VADDetector 管理、Session 创建/销毁、UIState 广播、ASR Provider 创建 |
| `asr/factory.ts` | ASR Provider 工厂函数 |
| `asr/webspeech.ts` | Web Speech API 实现，浏览器内置语音识别（零 IPC） |
| `asr/doubao.ts` | 豆包 ASR 实现，通过 IPC 与主进程通信 |
| `ui/VoiceFloatingPanel.tsx` | React Portal 浮动面板 UI，纯状态观察者 |
| `utils/auto-send.ts` | 语音识别文本自动发送判断（always / smart / AI 三种策略） |
| `utils/pcm.ts` | PCM 音频工具函数：采样率转换、缓冲合并、分片 |

## 依赖关系图（修复后）

```
types/  ←  asr/  ←  core/Orchestrator  →  utils/
          ↑              │
          │              ├→ core/AudioHub      (只依赖 types)
          │              ├→ core/StateMachine   (只依赖 types)
          │              ├→ core/Session        (依赖 types + 注入的 subscribe/provider)
          │              └→ asr/factory → {DoubaoProvider, WebSpeechProvider}
          │
          └— core/Orchestrator 是唯一的"知情人"，负责组装所有依赖

Session 不再 import:
  ✗ import type { AudioHub }           ← 同级横向依赖
  ✗ import { createASRProvider }       ← 向下游直接调用
  ✗ import 来自 utils/pcm              ← 未使用代码

Session 的依赖全部来自 types/ + 构造函数注入:
  ✓ type PcmSubscriber — 由 subscribe 函数类型携带
  ✓ type ASRProvider   — 由 provider 参数携带
  ✓ VoiceDictationSettings, SessionCallbacks
```

## 核心设计原则

1. **单次录音单 Session** — 每轮录音创建一个独立的 Session 实例，不跨轮泄漏状态
2. **AudioHub 单例** — 整个应用只有一个 `getUserMedia` 调用，VAD 和 Session 通过 `subscribe()` 接收 PCM 帧
3. **FSM 严格守卫** — 每个状态转换都经过 `VALID_TRANSITIONS` 表校验，拒绝非法跳转
4. **Orchestrator 中控** — 所有状态的变更和 UI 广播都经过 Orchestrator，React 层只做纯渲染
5. **依赖倒置** — Session 不依赖具体实现（AudioHub / VADDetector / ASR Provider），通过构造函数注入 `subscribe` 函数、`VADDetector` 和 `ASRProvider` 接口。Orchestrator 负责组装所有依赖，`core/` 内部不产生同级横向依赖
6. **静音检测与自动重连** — 免提模式下 VAD 检测到语音自动启动录音，完成后 2 秒自动回归 listening 状态
