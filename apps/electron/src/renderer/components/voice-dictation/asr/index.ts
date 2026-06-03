/**
 * ASR 模块入口
 *
 * 统一导出类型、工厂和各 Provider，实现按目录聚合。
 */

export * from './factory'
export * from './shared/completion'
export * from '../shared/types/asr'
export * from './providers/doubao/index.ts'
export * from './providers/webspeech/index.ts'
