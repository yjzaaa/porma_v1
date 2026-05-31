/**
 * HandsfreeButton — 免提模式切换按钮
 *
 * 显示当前免提模式状态，点击切换免提模式的启用/禁用。
 * 状态样式随检测器状态变化：空闲、监听中、检测到声音、录音中。
 */

import { useCallback } from 'react'
import { Ear, EarOff, Loader2, Mic } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { handsfreeStateAtom } from '@/atoms/handsfree-state-atom'

export function HandsfreeButton({
  className,
}: {
  className?: string
}): React.ReactElement {
  const state = useAtomValue(handsfreeStateAtom)

  const handleClick = useCallback((): void => {
    void (async () => {
      try {
        const settings = await window.electronAPI.getVoiceDictationSettings()
        const nextEnabled = !settings.handsfreeEnabled

        await window.electronAPI.updateVoiceDictationSettings({
          ...settings,
          handsfreeEnabled: nextEnabled,
          // 开启免提时自动启用语音输入
          enabled: nextEnabled || settings.enabled,
        })

        await window.electronAPI.reregisterGlobalShortcuts()
        window.dispatchEvent(new CustomEvent('proma:voice-settings-changed'))

        if (nextEnabled) {
          toast.success('免提模式已开启，对着麦克风说话即可自动输入')
        } else {
          toast.info('免提模式已关闭')
        }
      } catch (error) {
        console.error('[免提] 切换失败:', error)
        toast.error('切换免提模式失败')
      }
    })()
  }, [])

  const { handsfreeEnabled, detectorState, voiceDictationActive } = state

  // 免提关 → 普通灰色图标
  if (!handsfreeEnabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'relative size-[36px] shrink-0 rounded-full text-foreground/60 hover:text-foreground',
              className
            )}
            onClick={handleClick}
          >
            <EarOff className="size-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>免提模式（点击开启）</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  // 免提开 → 根据检测器状态显示不同样式
  const isActive = detectorState === 'hearing' || detectorState === 'activating' || voiceDictationActive
  const isActivating = detectorState === 'activating' || voiceDictationActive

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-[36px] shrink-0 rounded-full transition-all duration-200',
            voiceDictationActive
              ? 'text-blue-500 bg-blue-500/10 animate-pulse'
              : isActivating
                ? 'text-blue-500 bg-blue-500/10 animate-pulse'
                : isActive
                  ? 'text-green-500 bg-green-500/10'
                  : 'text-green-500/70 hover:text-green-500 hover:bg-green-500/10',
            className
          )}
          onClick={handleClick}
        >
          {voiceDictationActive || isActivating ? (
            <Mic className="size-[18px]" />
          ) : (
            <Ear className="size-[18px]" />
          )}
          {/* 小圆点指示器 */}
          <span className={cn(
            'absolute -top-[2px] -right-[2px] size-2 rounded-full border-2 border-background',
            voiceDictationActive ? 'bg-blue-500' : isActive ? 'bg-green-500' : 'bg-green-500/50'
          )} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>
          {voiceDictationActive
            ? '免提 · 录音中'
            : isActivating
              ? '免提 · 语音输入中...'
              : isActive
                ? '免提 · 检测到声音'
              : '免提 · 监听中（点击关闭）'}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
