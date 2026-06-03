/**
 * 豆包 ASR 共享会话上下文
 *
 * 音频层和 transport 层都依赖这两个最基础的会话判断能力：
 * - 当前会话是否还存在
 * - 当前会话是否处于停止中
 *
 * 先抽这一层，可以让上层 options 的继承关系更清晰。
 */

/**
 * 豆包 ASR 共享会话上下文
 */
export interface DoubaoSessionContext {
  /** 当前会话 ID */
  getSessionId: () => string | null
  /** 当前是否处于停止中 */
  isStopping: () => boolean
}
