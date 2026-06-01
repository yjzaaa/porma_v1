/**
 * 语音模块 — StateMachine 有限状态机
 *
 * 严格守卫每个状态转换，拒绝非法跳转以防止竞态 bug。
 * 配合 VALID_TRANSITIONS 表（panel.ts），所有进入记录状态前必须先经过 listening。
 *
 * 状态流：
 *   stopped → listening → recording → processing → completed
 *       ↑         ↓            ↓ ↘         ↓
 *       └─────────┴────────────┴─ error ←─┘
 *
 * @see ../types/panel.ts - VALID_TRANSITIONS 定义
 */

import type { PanelState } from '../types/panel'
import { VALID_TRANSITIONS } from '../types/panel'

/** 状态变更监听器：from → to */
export type StateListener = (from: PanelState, to: PanelState) => void

export class StateMachine {
  /** 当前状态，初始为 stopped */
  private _state: PanelState = 'stopped'
  /** 状态变更监听器集合 */
  private listeners = new Set<StateListener>()

  /** 获取当前状态 */
  get state(): PanelState { return this._state }

  /**
   * 尝试执行状态转换
   *
   * @param to - 目标状态
   * @returns 转换是否成功（false 表示非法转换被拒绝）
   *
   * 幂等性：from === to 时返回 true 但不触发 listener
   */
  transition(to: PanelState): boolean {
    const from = this._state
    // 幂等：已处于目标状态，跳过
    if (from === to) return true
    const allowed = VALID_TRANSITIONS[from]
    if (!allowed?.includes(to)) {
      console.warn(`[StateMachine] 非法转换: ${from} → ${to}（允许: ${allowed?.join(', ') ?? '无'}）`)
      return false
    }
    this._state = to
    // 广播：逐一通知所有监听器，单个异常不影响其他监听器
    for (const l of this.listeners) {
      try { l(from, to) } catch {}
    }
    return true
  }

  /**
   * 订阅状态变更事件
   *
   * @param fn - 变更回调 (from, to)
   * @returns 取消订阅函数（调用后不再接收变更通知）
   */
  onChange(fn: StateListener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}
