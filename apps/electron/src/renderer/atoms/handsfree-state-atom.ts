/**
 * 免提模式 / 语音输入状态原子
 *
 * 在 GlobalShortcuts 中更新，被 HandsfreeButton 消费。
 */
import { atom } from 'jotai'
import type { DetectorState } from '@/components/voice-dictation/voice-activity-detector'

export interface HandsfreeState {
  /** 免提模式是否启用 */
  handsfreeEnabled: boolean
  /** 检测器当前状态 */
  detectorState: DetectorState
  /** 语音输入浮窗是否显示且活跃 */
  voiceDictationActive: boolean
}

export const handsfreeStateAtom = atom<HandsfreeState>({
  handsfreeEnabled: false,
  detectorState: 'inactive',
  voiceDictationActive: false,
})
