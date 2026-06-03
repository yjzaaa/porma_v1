/**
 * 语音模块 IPC 桥接契约
 *
 * 由 hook 层实现 `window.electronAPI` 访问，核心业务层只依赖这些抽象回调。
 */

import type { VoiceDictationCommitInput, VoiceDictationCommitResult } from '../../../../../types'

/** 语音模块对外 IPC 能力 */
export interface VoiceDictationIpcBridge {
  /** 提交语音识别文本到主进程 */
  commitVoiceDictation: (input: VoiceDictationCommitInput) => Promise<VoiceDictationCommitResult>
  /** 停止指定 Agent 会话 */
  stopAgent: (sessionId: string) => Promise<void>
  /** 写入语音模块日志 */
  writeVoiceDictationLog: (logContent: string) => Promise<void>
}
