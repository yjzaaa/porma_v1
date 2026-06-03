/**
 * 【第 4 层 - 业务模块层】语音领域模块基类（统一事件总线 + 生命周期约束）
 *
 * 职责：提供所有业务模块的统一抽象，封装事件订阅/发布、生命周期管理
 */

import type { VoiceEventLogger } from '../../ui-events'
import type {
  VoiceDomainEventBus,
  VoiceDomainEventListener,
  VoiceDomainEventMap,
  VoiceDomainEventType,
} from '../../shared/bus/VoiceDomainEventBus'

/**
 * 统一模块抽象：
 * - 通过 on/emit 访问总线
 * - 统一管理订阅清理
 */
export abstract class BaseVoiceModule {
  private readonly unsubs: Array<() => void> = []

  constructor(
    protected readonly bus: VoiceDomainEventBus,
    protected readonly logger: VoiceEventLogger,
  ) {}

  /**
   * 订阅领域事件并自动纳入销毁清理
   */
  protected on<K extends VoiceDomainEventType>(
    event: K,
    listener: VoiceDomainEventListener<K>,
  ): void {
    this.unsubs.push(this.bus.on(event, listener))
  }

  /**
   * 发布领域事件
   */
  protected emit<K extends VoiceDomainEventType>(
    event: K,
    payload: VoiceDomainEventMap[K],
  ): void {
    this.bus.emit(event, payload)
  }

  /**
   * 清理所有订阅（子类 dispose 中调用）
   */
  protected disposeSubscriptions(): void {
    this.unsubs.forEach((unsub) => unsub())
  }

  /**
   * 模块销毁钩子
   */
  abstract dispose(): void
}
