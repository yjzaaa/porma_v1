/**
 * StateMachine — 语音面板有限状态机
 *
 * 严格守卫每个状态转换，拒绝非法跳转。
 * 配合 VALID_TRANSITIONS 表，阻止重复触发等竞态 bug。
 */

import type { PanelState } from './types'
import { VALID_TRANSITIONS } from './types'

export type StateListener = (from: PanelState, to: PanelState) => void

export class StateMachine {
  private _state: PanelState = 'stopped'
  private listeners = new Set<StateListener>()

  get state(): PanelState { return this._state }

  /** 尝试转换，返回是否成功 */
  transition(to: PanelState): boolean {
    const from = this._state
    if (from === to) return true // 幂等
    const allowed = VALID_TRANSITIONS[from]
    if (!allowed?.includes(to)) {
      console.warn(`[StateMachine] 非法转换: ${from} → ${to}（允许: ${allowed?.join(', ') ?? '无'}）`)
      return false
    }
    this._state = to
    for (const l of this.listeners) {
      try { l(from, to) } catch {}
    }
    return true
  }

  /** 订阅状态变更 */
  onChange(fn: StateListener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}
