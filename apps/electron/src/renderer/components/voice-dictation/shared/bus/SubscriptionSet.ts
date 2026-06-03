/**
 * 可取消订阅集合
 *
 * 用于管理单组监听器，保持 on / clear 风格一致。
 * 与按事件键分组的总线不同，这里只处理一条通道上的监听器，
 * 例如 request / event 这种单列表场景。
 */

/**
 * 统一的监听器集合
 *
 * 本类的目标只有一个：把“加入监听器”和“返回取消函数”绑定成原子操作，
 * 让调用方不必自己再包一层 delete。
 */
export class SubscriptionSet<TListener> {
  private readonly listeners = new Set<TListener>()

  /**
   * 添加监听器并返回取消订阅函数
   *
   * 订阅成功后立即返回清理句柄，外部只需要保存这个函数即可。
   */
  add(listener: TListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 遍历所有监听器
   *
   * 用于广播请求或事件给所有订阅方。
   */
  forEach(callback: (listener: TListener) => void): void {
    for (const listener of this.listeners) {
      callback(listener)
    }
  }

  /**
   * 当前监听器数量
   *
   * 常用于判断外部处理层是否已经挂载。
   */
  size(): number {
    return this.listeners.size
  }

  /**
   * 清空所有监听器
   *
   * 只清引用，不做额外回调，适合销毁阶段直接回收。
   */
  clear(): void {
    this.listeners.clear()
  }
}
