/**
 * 通用类型安全事件总线
 *
 * 这是对 AbstractTypedEventBus 的具体化实现，适合“只有事件订阅/广播”
 * 这一类简单通道，不需要再为每个业务单独写一套 Set 初始化逻辑。
 */

import { AbstractTypedEventBus, type TypedListenerMap } from './AbstractTypedEventBus'

export type { TypedListenerMap } from './AbstractTypedEventBus'

/**
 * 通用事件总线
 *
 * 只提供具体实现，不额外增加业务语义。
 */
export class TypedEventBus<TEventMap extends object> extends AbstractTypedEventBus<TEventMap> {
  constructor(listeners: TypedListenerMap<TEventMap>) {
    super(listeners)
  }
}
