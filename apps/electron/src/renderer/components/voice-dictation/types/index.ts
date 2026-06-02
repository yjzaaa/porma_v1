/**
 * 语音模块 — 类型重导出入口
 *
 * 统一导出所有模块共用的类型定义：
 * - panel.ts: 面板状态（PanelState）、PCM 帧（PcmFrame）、会话结果（SessionResult）、UI 状态（VoiceUIState）
 * - asr.ts: ASR Provider 接口（ASRProvider）、回调契约（ASRCallbacks）、Provider 类型（ASRProviderType）
 */
export type { PcmFrame, PcmSubscriber, PanelState, DetectorState, SessionResult, VoiceUIState, UIStateListener } from './panel'
export type { ASRProvider, ASRCallbacks, ASRProviderType } from './asr'
