/**
 * 统一的类型安全事件总线基类
 *
 * 负责封装 on / emit / clear 的公共逻辑。
 * 这里抽象的是“监听器集合 + 订阅/广播/清理”这一组重复模式，
 * 不是把业务事件语义也一起抽掉。
 */

/**
 * 事件监听器映射
 *
 * 每个事件键对应一个独立的监听器集合，避免不同事件之间互相串台。
 */
export type TypedListenerMap<TEventMap extends object> = {
  [K in keyof TEventMap]: Set<(payload: TEventMap[K]) => void>
}

/**
 * 类型安全事件总线基类
 *
 * 子类只需要提供初始化好的 listener 表，基类负责统一的订阅、
 * 广播和清空逻辑。
 */
export abstract class AbstractTypedEventBus<TEventMap extends object> {
  protected constructor(protected readonly listeners: TypedListenerMap<TEventMap>) {}

  /**
   * 订阅指定事件
   *
   * 返回取消函数是为了让上层生命周期管理更直接：订阅时拿到一次性
   * 清理句柄，dispose 时逐个执行即可。
   *
   * @returns 取消订阅函数
   */
  on<K extends keyof TEventMap>(event: K, listener: (payload: TEventMap[K]) => void): () => void {
    const set = this.listeners[event]
    set.add(listener)
    return () => set.delete(listener)
  }

  /**
   * 发布指定事件
   *
   * 逐个同步通知当前事件键下的监听器，不做额外调度。
   */
  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
    const set = this.listeners[event]
    for (const listener of set) {
      listener(payload)
    }
  }

  /**
   * 清空所有监听器
   *
   * 用于模块销毁时的一次性回收，不保留任何订阅状态。
   */
  clear(): void {
    ;(Object.keys(this.listeners) as Array<keyof TEventMap>).forEach((key) => {
      this.listeners[key].clear()
    })
  }
}
