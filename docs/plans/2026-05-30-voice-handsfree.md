# 语音输入"免提优化"实施计划

> **身份**: 纯计划与决策追踪 — 代码细节见 `code/` 和 `modules/`
> **目标**: 逐步消除键盘和鼠标依赖，实现全程免提的语音交互体验
> **架构原则**: 在现有音频管线（PCM → 豆包 ASR → 文本插入）上叠加客户端智能层

**技术栈**: TypeScript + Electron + React + 豆包 ASR WebSocket + Web Audio API + Porcupine

---

## 总体路线图

```
Phase 1 (P0)          Phase 2 (P1)          Phase 3 (P2)          Phase 4 (P3)          Phase 5 (P4)
VAD 自动停止          语义自动发送           唤醒词检测             语音命令               免提模式
─────→               ─────→               ─────→               ─────→               ─────→
Week 1               Week 2               Week 3-4             Week 5-6             Week 7-8
消除 Ctrl+` 停止      消除手动点发送         消除 Ctrl+` 触发      语音控制 Proma         全流程闭环
```

每个阶段独立可交付、独立可验证。

---

## Phase 1: VAD 自动停止（P0）✅ 已完成

### Spec

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

  Scenario: 用户可手动提前停止
    Given: 用户正在录音中
    When: 用户按 Ctrl+` 或点击停止按钮
    Then: 录音立即停止（保持现有行为）
```

### 实现细节

| 文件 | 说明 |
|------|------|
| `VoiceDictationApp.tsx` | VAD 核心实现在 `onaudioprocess` 回调中（详见下方代码文档）|
| `voice-dictation-settings-service.ts` | `vadStopTimeoutMs`（默认 1800）/ `vadMinRecordMs`（默认 500） |

**设计参数**:
- 静音阈值: 音量峰值 < 0.01
- 静音超时: `vadStopTimeoutMs`（默认 1800ms，设为 0 禁用 VAD）
- 最短录音: `vadMinRecordMs`（默认 500ms，防止误触发）

### 验收状态

- [x] 说完话停顿 > 1.8s → 自动停止录音并提交文本
- [x] 说话中短暂停顿（< 1.8s）→ 不触发停止
- [x] 录音 < 500ms → 不触发自动停止
- [x] 手动 Ctrl+` 停止 → 仍然生效
- [x] 设置中可调整静音超时和最短录音时长
- [x] 设置为 0 时 VAD 功能禁用，回退到手动模式

---

## Phase 2: 语义自动发送（P1）✅ 已完成

### Spec

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

### 实现细节

| 文件 | 逻辑 |
|------|------|
| [voice-auto-send.ts](../../code/renderer/components/voice-dictation/voice-auto-send.md) | 判断是否自动发送（三种模式） |
| [GlobalShortcuts.tsx](../../code/renderer/components/shortcuts/GlobalShortcuts.md) | 自动发送触发 + 乐观更新 |
| [text-output-service.ts](../../code/main/lib/text/text-output-service.md) | 文本输出路由 |

**当前方案**: `always` 模式（文本 >= 4 字符直接发送），`smart` / `ai` 模式代码已预留但未启用。

### 与原计划的差异

| 原计划 | 实际实现 |
|--------|---------|
| 创建 `semantic-completeness.ts` AI 判断服务 | 未创建，采用 'always' 模式直接发送 |
| 调用轻量 AI 模型判断完整性 | 仅检查文本长度 >= 4 |
| 800ms 超时降级 | 不涉及 |
| 本地 hash 缓存 | 不涉及 |

### 验收状态

- [x] "帮我重构 agent-orchestrator.ts"（>= 4 字符）→ 自动发送
- [x] "好的"（< 4 字符）→ 不自动发送
- [x] 关闭 autoSendEnabled 后 → 从不自动发送
- [ ] ~~"我想问一下" → 不自动发送（smart 模式未启用）~~
- [ ] ~~"这个项目的架构是什么？"（问号结尾）→ smart 模式判断~~

### 后续增强

如需启用更智能的判断，`shouldAutoSend()` 中两个预留模式可直接使用：
- **smart 模式**: 正则规则（`INCOMPLETE_ENDINGS` / `SENTENCE_END_PUNCTUATION`）已就绪，只需调用处将 mode 改为 `'smart'`
- **ai 模式**: 需要创建 `semantic-completeness.ts` 服务

---

## Phase 3: 免提语音活动检测（P2）✅ 已完成

### Spec

```yaml
Feature: 免提语音活动检测
  As a: Proma 用户
  I want: 对着麦克风说话就能开始语音输入
  So that: 完全不需要任何键盘或语音唤醒词触发

  Scenario: 连续说话触发录音
    Given: 免提模式已开启
    When: 用户对着麦克风连续说话超过 800ms
    Then: 语音浮窗自动出现并开始录音

  Scenario: 短暂噪音不触发
    Given: 免提模式已开启
    When: 用户咳嗽或短暂说话不到 800ms
    Then: 不触发录音

  Scenario: 不说话不消耗资源
    Given: 免提模式已开启但用户不说话
    When: 连续静默超过检测窗口
    Then: 麦克风保持低功耗状态，不触发录音
```

### 技术方案

**放弃所有文本识别方案**（Porcupine / SpeechRecognition API），采用纯能量检波：

```typescript
// voice-activity-detector.ts — 核心逻辑
const detector = new VoiceActivityDetector({
  threshold: 0.03,     // 语音能量阈值（高于 Phase 1 VAD 的 0.01）
  durationMs: 800,     // 连续语音持续多久后触发
  cooldownMs: 3000,    // 触发后冷却时间
  onActivate: () => toggleVoiceDictation(),
})
detector.start()
// ...
detector.stop()
```

### 设计决策

| 维度 | SpeechRecognition（上一版） | 能量检波（当前） |
|------|---------------------------|----------------|
| 识别方式 | 文本匹配（"Hey Proma"） | **纯能量检测** |
| 语言依赖 | 中英文混输问题 | **无视语言** |
| 30s 断连 | 需要 restart 循环补偿 | **无断连问题** |
| CPU 消耗 | 整个 ASR 引擎 | AnalyserNode + RAF 约 60fps |
| 环境噪音 | 无法过滤 | 提高阈值至 0.03 即可 |
| 误触发 | 近似发音 | 连续说话超 800ms 才触发 |
| 不说话时 | SpeechRecognition 不断重连 | **关闭麦克风，零消耗** |

### 实现文件

| 文件 | 作用 |
|------|------|
| [voice-activity-detector.ts](../../code/renderer/components/voice-dictation/voice-activity-detector.md) | 能量检波检测类 |
| [GlobalShortcuts.tsx](../../code/renderer/components/shortcuts/GlobalShortcuts.md) | 免提模式生命周期管理 |
| [VoiceInputSettings.tsx] | 设置页面开关 |
| [VoiceDictationSettings 类型] | `handsfreeEnabled` 字段 |

### 验收状态

- [x] 连续说话 > 800ms → 语音浮窗出现并开始录音
- [x] 短暂噪音（咳嗽、关门）< 800ms → 不触发
- [x] 免提模式关闭时，麦克风完全关闭，零资源消耗
- [x] 设置页面可开关免提模式

---

## Phase 4: 语音命令（P3）🔲 未开始

### Spec

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

- [ ] Task 4.1: 创建本地命令匹配器 `voice-command-matcher.ts`
- [ ] Task 4.2: 创建命令执行调度器 `voice-command-executor.ts`
- [ ] Task 4.3: 集成到文本提交流程（`commitAndHide` 之前过命令匹配器）

### ⚠️ 已知风险

- **命令/对话混淆**: 高频词如"发送"在日常对话中易误触发，需设计兜底机制（如 3s 内说"撤销"回退）
- **模糊匹配边界**: "发"→"发送"、"新建一个"→"新建"，匹配阈值的设定需要实测

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

- [ ] Task 5.1: 免提模式状态机 `handsfree-state-machine.ts`
- [ ] Task 5.2: 免提模式音频反馈（唤醒/开始/停止/成功/错误提示音）
- [ ] Task 5.3: 免提模式全局开关（托盘图标 + 快捷键 + 空闲自动退出）

### 验收标准

- [ ] 免提模式下完整对话流（唤醒 → 录音 → 发送 → 执行）零键鼠参与
- [ ] 免提模式状态在托盘和浮窗正确显示
- [ ] 说"停止"可中断 Agent 执行
- [ ] 30 分钟无交互自动退出免提模式
- [ ] 免提模式开启时不影响系统其他音频应用

---

## 阶段交付总结

| Phase | 交付物 | 状态 | 采用方案 |
|-------|--------|------|---------|
| 1 | VAD 自动停止 | ✅ 已完成 | `VoiceDictationApp.tsx` 内静音检测 |
| 2 | 语义自动发送 | ✅ 已完成（always） | `voice-auto-send.ts` + `GlobalShortcuts.tsx` |
| 3 | 免提语音活动检测 | ✅ 已完成 | `VoiceActivityDetector` 基于 Web Audio API 能量检波，`handsfreeEnabled` 设置控制 |
| 4 | 语音命令 | 🔲 未开始 | 本地正则匹配（需兜底机制）|
| 5 | 免提模式 | 🔲 未开始 | 状态机 + 音频反馈 |

---

## 代码文档索引

| 主题 | 文档 | 内容 |
|------|------|------|
| VAD 实现详解 | [VoiceDictationApp.md](../code/renderer/components/voice-dictation/VoiceDictationApp.md) | 架构图、VAD 流程、核心代码解析 |
| 唤醒词检测 | [wake-word-light.md](../code/renderer/components/voice-dictation/wake-word-light.md) | SpeechRecognition API 封装、生命周期 |
| 自动发送判断 | [voice-auto-send.md](../code/renderer/components/voice-dictation/voice-auto-send.md) | always/smart/ai 三种模式 |
| 自动发送触发 | [GlobalShortcuts.md](../code/renderer/components/shortcuts/GlobalShortcuts.md) | 乐观更新、提交流程图 |
| 文本输出路由 | [text-output-service.md](../code/main/lib/text/text-output-service.md) | 输出模式、IPC 通道 |
| 文本合并状态机 | [voice-transcript-merge.md](../code/renderer/components/voice-dictation/voice-transcript-merge.md) | ASR 增量文本去重 |
| 豆包 ASR 服务 | [Integration README](../code/main/lib/integration/README.md) | WebSocket 协议、音频帧格式 |
| 完整 IPC 时序 | [arch/10-voice-dictation-ipc.md](../arch/10-voice-dictation-ipc.md) | 跨进程调用链、IRL 序列图 |

---

**最后更新**: 2026-05-31  
**版本**: 2.0（重构为纯计划文档）
