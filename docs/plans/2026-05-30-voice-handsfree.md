# 语音输入"免提优化"实施计划

> **For Claude:** 使用 executing-plans skill 按阶段逐步实施此计划。
> **Spec 优先**：每个阶段先写 Spec，再按 Spec 拆分为可验证的具体任务。

**目标：** 逐步消除 Proma 语音输入对键盘和鼠标的依赖，最终实现全程免提的语音交互体验。

**架构原则：** 在现有音频管线（PCM → 豆包 ASR → 文本插入）上叠加客户端智能层，最小化对现有代码的侵入性变更。

**技术栈：** TypeScript + Electron + React + 豆包 ASR WebSocket + Web Audio API + Porcupine（唤醒词）

**相关文件索引：**
- `apps/electron/src/main/lib/integration/doubao-asr-service.ts` — 豆包 ASR WebSocket 协议
- `apps/electron/src/main/lib/integration/voice-dictation-settings-service.ts` — 语音设置持久化
- `apps/electron/src/main/lib/window/voice-dictation-window.ts` — 语音浮窗管理
- `apps/electron/src/main/lib/text/text-output-service.ts` — 文本输出路由
- `apps/electron/src/main/lib/text/text-insertion-service.ts` — 系统粘贴
- `apps/electron/src/main/lib/system/global-shortcut-service.ts` — 全局快捷键
- `apps/electron/src/renderer/components/voice-dictation/VoiceDictationApp.tsx` — 语音浮窗 UI
- `apps/electron/src/renderer/components/voice-dictation/voice-audio-utils.ts` — PCM 工具
- `apps/electron/src/renderer/components/voice-dictation/voice-transcript-merge.ts` — 文本合并状态机
- `apps/electron/src/renderer/components/voice-dictation/voice-auto-send.ts` — 自动发送判断
- `apps/electron/src/renderer/lib/voice-input-focus.ts` — 焦点跟踪
- `apps/electron/src/renderer/components/shortcuts/GlobalShortcuts.tsx` — 文本插入调度 + 自动发送
- `apps/electron/src/types/settings.ts` — 语音设置类型定义（`VoiceDictationSettings`）

---

## 总体路线图

```
Phase 1 (P0)          Phase 2 (P1)          Phase 3 (P2)          Phase 4 (P3)          Phase 5 (P4)
VAD 自动停止          语义自动发送           唤醒词检测             语音命令               免提模式
─────→               ─────→               ─────→               ─────→               ─────→
Week 1               Week 2               Week 3-4             Week 5-6             Week 7-8
消除 Ctrl+` 停止      消除手动点发送         消除 Ctrl+` 触发      语音控制 Proma         全流程闭环
```

每个阶段独立可交付、独立可验证，不依赖后续阶段即可上线使用。

---

## Phase 1: VAD 自动停止（P0）✅ 已完成

### Spec

**问题：** 用户说完话后必须再按一次 Ctrl+` 才能停止录音，打断思维流。

**目标：** 用户说完话并停顿后自动停止录音，无需手动操作。

**Spec 文档：**

```yaml
Feature: VAD 自动停止
  As a: Proma 语音输入用户
  I want: 说完话后自动停止录音
  So that: 不需要再按一次快捷键

  Scenario: 正常说完一句话后自动停止
    Given: 用户正在录音中
    When: 用户说完一句话，停顿超过 vadStopTimeoutMs（默认 1800ms）
    Then: 录音自动停止
    And: 文本自动提交

  Scenario: 说话中短暂停顿不触发停止
    Given: 用户正在录音中
    When: 用户说话中停顿不超过 vadStopTimeoutMs
    Then: 录音继续
    And: 不触发停止

  Scenario: 用户可手动提前停止
    Given: 用户正在录音中
    When: 用户按 Ctrl+` 或点击停止按钮
    Then: 录音立即停止（保持现有行为）
```

### 实际实现

**文件：** `VoiceDictationApp.tsx`

- **静音阈值：** `VAD_THRESHOLD = 0.01`（音量峰值低于此值视为静音）
- **静音超时：** `settings.vadStopTimeoutMs`（默认 1800ms，设为 0 禁用 VAD）
- **最短录音：** `settings.vadMinRecordMs`（默认 500ms，防止误触发）

```typescript
// VoiceDictationApp.tsx:45-49 — VAD refs
const silenceSinceRef = React.useRef<number>(-1)
const recordingStartedAtRef = React.useRef<number>(0)
const vadTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

// VoiceDictationApp.tsx:258-284 — VAD 核心检测（在 onaudioprocess 回调中）
const VAD_THRESHOLD = 0.01
const now = Date.now()
if (peak >= VAD_THRESHOLD) {
  silenceSinceRef.current = now  // 检测到语音，刷新时间戳
}
if (timeoutMs > 0 &&
    now - silenceSinceRef.current >= timeoutMs &&
    now - recordingStartedAtRef.current >= minRecordMs) {
  vadTimerRef.current = setTimeout(() => {
    stopRecording().catch(() => {})
  }, 0)
}
```

**设置项：** `VoiceDictationSettings.vadStopTimeoutMs` 和 `vadMinRecordMs`，在 `voice-dictation-settings-service.ts` 中定义默认值。

### 验收状态

- [x] 说完话停顿 > 1.8s → 自动停止录音并提交文本
- [x] 说话中短暂停顿（< 1.8s）→ 不触发停止
- [x] 录音 < 500ms → 不触发自动停止
- [x] 手动 Ctrl+` 停止 → 仍然生效
- [x] 设置中可调整静音超时和最短录音时长
- [x] 设置为 0 时 VAD 功能禁用，行为回退到手动模式

---

## Phase 2: 语义自动发送（P1）✅ 已完成（方案一：直接发送模式）

### Spec

**问题：** ASR 识别完成后，文本已插入输入框，但用户仍需手动点击发送或按 Enter。

**目标：** 系统自动判断用户输入是否为"完整可执行的指令"，是则自动发送。

**Spec 文档：**

```yaml
Feature: 语义自动发送
  As a: Proma 语音输入用户
  I want: 系统自动判断我的语音是否"说完了一个完整的指令"
  So that: 无需手动点击发送按钮

  Scenario: 自动发送（always 模式）
    Given: autoSendEnabled = true, mode = 'always'
    When: 语音识别完成，文本长度 >= 4 字符
    Then: 文本自动发送到 Agent

  Scenario: 用户可在设置中关闭自动发送
    Given: autoSendEnabled = false
    When: 语音识别完成
    Then: 文本插入输入框，不自动发送

  Scenario: 文本太短不发送
    Given: autoSendEnabled = true
    When: 语音识别完成，文本为 "好的"（< 4 字符）
    Then: 文本插入输入框但不自动发送
```

### 实际实现

**当前采用方案一（'always' 模式）：** 只要 `autoSendEnabled=true` 且文本长度 >= 4 字符就直接发送，无需 AI 调用。

**文件：** `voice-auto-send.ts`

```typescript
// voice-auto-send.ts — 自动发送判断
const MIN_AUTO_SEND_LENGTH = 4

export function shouldAutoSend(
  text: string,
  enabled: boolean,
  mode: 'always' | 'smart' | 'ai',
): boolean {
  if (!enabled) return false
  const trimmed = text.trim()
  if (trimmed.length < MIN_AUTO_SEND_LENGTH) return false

  if (mode === 'always') return true         // ← 当前使用
  if (mode === 'smart') return smartCheck()  // 预留：本地正则判断
  if (mode === 'ai') return aiCheck()        // 预留：AI 语义判断
}
```

**自动发送流程（GlobalShortcuts.tsx）：**

```
文本插入 → GlobalShortcuts.onVoiceDictationInsertText()
  → 路径 A: TipTap 编辑器拦截 → tryAutoSendAgent()
  → 路径 B: Agent 草稿路径 → shouldAutoSend() → sendAgentMessage()
```

自动发送前的乐观更新（`tryAutoSendAgent`）：
1. 清除草稿（`agentSessionDraftsAtom`）
2. 设置流式状态（`agentStreamingStatesAtom`）
3. 乐观插入用户消息（`liveMessagesMapAtom`）
4. IPC 调用 `sendAgentMessage`

**预留但未启用的模式：**
- `smart` 模式：本地正则判断（`INCOMPLETE_ENDINGS` / `SENTENCE_END_PUNCTUATION`）
- `ai` 模式：调用 AI 判断完整性（需创建 `semantic-completeness.ts`）

**设置项：** `VoiceDictationSettings.autoSendEnabled`（默认 `true`）

### 与原计划的差异

| 原计划 | 实际实现 |
|--------|---------|
| 创建 `semantic-completeness.ts` AI 判断服务 | 未创建，采用 'always' 模式直接发送 |
| 调用轻量 AI 模型判断完整性 | 仅检查文本长度 >= 4 |
| 800ms 超时降级 | 不涉及，无 AI 调用 |
| 本地 hash 缓存 | 不涉及 |

### 验收状态

- [x] "帮我重构 agent-orchestrator.ts"（>= 4 字符）→ 自动发送
- [x] "好的"（< 4 字符）→ 不自动发送
- [x] 关闭 autoSendEnabled 后 → 从不自动发送
- [ ] ~~"我想问一下" → 不自动发送（smart 模式未启用）~~
- [ ] ~~"这个项目的架构是什么？"（问号结尾）→ smart 模式判断~~

### 后续增强（可选）

如需启用智能判断：
1. 在 `shouldAutoSend` 调用处将 `mode` 从 `'always'` 改为 `'smart'` 或 `'ai'`
2. `smart` 模式的正则已写好（`INCOMPLETE_ENDINGS` / `SENTENCE_END_PUNCTUATION`），可直接启用
3. `ai` 模式需创建 `semantic-completeness.ts` 服务

---

## 文本提交流程（Phase 1+2 支撑）

当前实现的完整提交链路，含三个触发时机：

```
触发时机 1 — 用户手动停止:
  stopRecording() → scheduleCommit(STOP_COMMIT_TIMEOUT_MS = 1400ms)

触发时机 2 — ASR 返回 isFinal:
  转写事件回调 → scheduleCommit(FINAL_COMMIT_DELAY_MS = 500ms)

触发时机 3 — VAD 静音超时:
  onaudioprocess → 检测静音 → stopRecording() → 间接触发时机 1
```

**提交流程：**

```
commitAndHide() [防重入: commitInFlightRef]
  → IPC commitVoiceDictation
    → text-output-service.commitVoiceDictationText()
      → outputMode='auto' 且 Proma 焦点 → INSERT_TEXT IPC 推送
      → 否则 → 光标粘贴 / 剪贴板
  → 成功后 280ms 自动隐藏浮窗

INSERT_TEXT → GlobalShortcuts.onVoiceDictationInsertText()
  → 路径 A: TipTap 编辑器拦截 → tryAutoSendAgent()
  → 路径 B: Agent 草稿写入 → shouldAutoSend() → sendAgentMessage()
```

---

## Phase 3: 唤醒词检测（P2）🔲 未开始

### Spec

**问题：** 每次语音输入需要按 Ctrl+` 触发，仍需要键盘参与。

**目标：** 说"Hey Proma"即可唤醒语音输入，无需按键。

**Spec 文档：**

```yaml
Feature: 唤醒词检测
  As a: Proma 用户
  I want: 说唤醒词就能开始语音输入
  So that: 完全不需要键盘触发

  Scenario: 唤醒词触发录音
    Given: 免提模式已开启
    When: 用户说"Hey Proma"
    Then: 语音浮窗出现并开始录音
    And: 播放轻提示音（ding）

  Scenario: 非唤醒词不触发
    Given: 免提模式已开启
    When: 用户说其他内容
    Then: 不触发录音

  Scenario: 录音中唤醒词被忽略
    Given: 正在录音中
    When: 用户说"Hey Proma"
    Then: 唤醒词被忽略（当作普通语音内容）
```

### 技术设计

在主进程新增 `wake-word-detector.ts`，使用 Porcupine 离线唤醒词引擎。音频输入从渲染进程 `getUserMedia` 改为主进程直接管理（或通过 IPC 转发 PCM 到主进程检测）。

```
麦克风 → 主进程 Porcupine → 检测到唤醒词 → 触发 toggleVoiceDictationWindow()
                                              ↓
                                         播放提示音
```

**关键决策：**
- Porcupine 模型：`Hey-Proma_en`（自定义唤醒词需要 Picovoice 训练，免费套餐每月 3 个自定义词）
- 或先用内置模型：`Porcupine` / `Computer` / `Jarvis` 等，后续再训练"Hey Proma"
- 功耗控制：Porcupine 持续运行的 CPU 占用 < 2%（实测数据）

### 任务列表

#### Task 3.1: 安装 Porcupine 依赖

```bash
cd apps/electron
bun add @picovoice/porcupine-node @picovoice/porcupine-web
```

#### Task 3.2: 创建主进程唤醒词服务

**创建：** `apps/electron/src/main/lib/integration/wake-word-detector.ts`

#### Task 3.3: 主进程音频捕获管线

**创建：** `apps/electron/src/main/lib/integration/background-audio-capture.ts`

主进程直接管理 `getUserMedia`（通过 `systemPreferences.askForMediaAccess`），不再依赖渲染进程。

#### Task 3.4: 免提模式状态管理

**修改：** `apps/electron/src/main/lib/window/voice-dictation-window.ts`

增加 `handsFreeMode` 状态，控制唤醒词引擎的启停。

#### Task 3.5: 设置页面增加唤醒词配置

增加唤醒词选择、免提模式开关、提示音开关。

### 验收标准

- [ ] 说唤醒词 → 语音浮窗出现并开始录音
- [ ] 日常对话不说唤醒词 → 不误触发（误触发率 < 1 次/小时）
- [ ] 噪音环境下唤醒词检测准确率 > 85%
- [ ] 免提模式关闭时，唤醒词引擎完全停止（零 CPU 占用）
- [ ] 免提模式开启时，后台 CPU 占用 < 5%

---

## Phase 4: 语音命令（P3）🔲 未开始

### Spec

**问题：** 部分高频操作（发送、取消、切换模式）仍需键鼠。

**目标：** 定义一套语音命令，让用户口述即可操作 Proma。

**Spec 文档：**

```yaml
Feature: 语音命令
  As a: Proma 用户
  I want: 用语音控制 Proma 的常见操作
  So that: 减少键鼠交互

  Scenario: 语音触发发送
    Given: 输入框中有待发送文本
    When: 用户说"发送消息"或"提交"
    Then: 触发发送

  Scenario: 语音创建新会话
    When: 用户说"新建会话"
    Then: 创建新的 Agent 会话

  Scenario: 语音响应权限请求
    Given: 有未处理的权限请求
    When: 用户说"允许"或"拒绝"
    Then: 响应权限请求
```

### 命令规范

命令格式：`<动作词> [目标]`

| 命令 | 触发操作 |
|------|---------|
| 发送 / 提交 | 发送当前输入框内容 |
| 取消 / 清除 | 清空当前输入 |
| 允许 / 拒绝 | 响应权限请求 |
| 新会话 / 新建 | 创建新会话 |
| 切换 Chat / 切换 Agent | 切换应用模式 |
| 停止 / 暂停 | 中断当前 Agent/Chat 输出 |
| 回到底部 | 滚动消息列表到底部 |

### 任务列表

#### Task 4.1: 创建本地命令匹配器

**创建：** `apps/electron/src/renderer/components/voice-dictation/voice-command-matcher.ts`

纯本地正则匹配，无需模型调用。支持模糊匹配（"发" → "发送"、"新建一个" → "新建"）。

#### Task 4.2: 命令执行调度器

**创建：** `apps/electron/src/renderer/components/voice-dictation/voice-command-executor.ts`

```typescript
type VoiceCommand = 'send' | 'cancel' | 'approve' | 'reject' | 'new_session' | 'switch_chat' | 'switch_agent' | 'stop' | 'scroll_bottom'

function executeVoiceCommand(command: VoiceCommand, context: CommandContext): void
```

#### Task 4.3: 集成到文本提交流程

在 `commitAndHide` 中，文本提交前先过命令匹配器。匹配到命令 → 执行命令操作。未匹配 → 正常文本提交。

### 验收标准

- [ ] "发送" / "发" / "提交消息" → 触发发送
- [ ] "允许" / "拒绝" → 响应权限请求
- [ ] "新会话" / "新建" → 创建新会话
- [ ] "停止" / "暂停" → 中断 Agent 输出
- [ ] 普通对话内容不误匹配为命令
- [ ] 所有命令可在设置中自定义别名

---

## Phase 5: 全程免提模式（P4）🔲 未开始

### Spec

**问题：** 前 4 个阶段各自解决了部分痛点，但尚未形成完整的免提闭环。

**目标：** 组合 Phase 1-4 所有能力，实现从触发到执行到反馈的完整免提工作流。

**Spec 文档：**

```yaml
Feature: 免提模式
  As a: Proma 用户
  I want: 开启免提模式后，全流程无需键鼠
  So that: 可以像和真人对话一样与 Proma 交流

  Scenario: 完整免提对话流
    Given: 免提模式已开启
    When: 用户说"Hey Proma，帮我重构 agent-orchestrator.ts"
    Then: 唤醒词检测到 → 自动开始录音
    And: 用户说完自动停止
    And: 语义分析判断为完整指令 → 自动发送
    And: Agent 开始执行
    And: 完成时播放提示音

  Scenario: 免提中断当前任务
    Given: Agent 正在执行中
    When: 用户说"Hey Proma 停止"
    Then: 中断当前 Agent 执行
```

### 任务列表

#### Task 5.1: 免提模式状态机

**创建：** `apps/electron/src/main/lib/integration/handsfree-state-machine.ts`

```typescript
type HandsfreeState = 'idle' | 'listening' | 'recording' | 'processing' | 'speaking'

// idle → (wake word) → recording → (VAD stop) → processing → (auto-send) → idle
// 任何状态 → (wake word + "停止") → idle
```

#### Task 5.2: 免提模式音频反馈

- 唤醒成功：短促 ding
- 开始录音：轻柔 click
- 自动停止：双音 ding-dong
- 自动发送成功：三连音
- 错误：低沉 buzz

#### Task 5.3: 免提模式全局开关

- 托盘图标显示免提状态（麦克风图标变色）
- 全局快捷键可切换免提模式开关
- 空闲超时自动退出免提（默认 30 分钟无交互）

### 验收标准

- [ ] 免提模式下完整对话流（唤醒 → 录音 → 发送 → 执行）零键鼠参与
- [ ] 免提模式状态在托盘和浮窗正确显示
- [ ] 说"停止"可中断 Agent 执行
- [ ] 30 分钟无交互自动退出免提模式
- [ ] 免提模式开启时不影响系统其他音频应用

---

## 阶段交付总结

| 阶段 | 交付物 | 状态 | 实际方案 |
|------|--------|------|---------|
| Phase 1 | VAD 自动停止 | ✅ 已完成 | `VoiceDictationApp.tsx` 内静音检测 + `vadStopTimeoutMs` / `vadMinRecordMs` 设置 |
| Phase 2 | 语义自动发送 | ✅ 已完成（always 模式） | `voice-auto-send.ts` 判断 + `GlobalShortcuts.tsx` 乐观发送，预留 smart/ai 模式 |
| Phase 3 | 唤醒词检测 | 🔲 未开始 | Porcupine 离线引擎 |
| Phase 4 | 语音命令 | 🔲 未开始 | 本地正则匹配 |
| Phase 5 | 免提模式 | 🔲 未开始 | 状态机 + 音频反馈 |

每个 Phase 结束时代码合并到 main 分支，作为独立功能发布，不用等全部完成。
