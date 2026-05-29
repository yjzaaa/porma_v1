import * as React from 'react'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface DisplayOptionsPopoverProps {
  autoPreviewEnabled: boolean
  processGroupsKeepExpanded: boolean
  onAutoPreviewChange: (enabled: boolean) => void
  onProcessGroupsKeepExpandedChange: (expanded: boolean) => void
}

export function DisplayOptionsPopover({
  autoPreviewEnabled,
  processGroupsKeepExpanded,
  onAutoPreviewChange,
  onProcessGroupsKeepExpandedChange,
}: DisplayOptionsPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const hasEnabledOption = autoPreviewEnabled || processGroupsKeepExpanded
  const hoverTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = React.useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    setOpen(true)
  }, [])

  const handleMouseLeave = React.useCallback(() => {
    hoverTimeout.current = setTimeout(() => setOpen(false), 150)
  }, [])

  React.useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-[36px] rounded-full',
            hasEnabledOption ? 'text-green-500' : 'text-foreground/60 hover:text-foreground'
          )}
          aria-label="显示选项"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Eye className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-auto min-w-[190px] p-2 px-2.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-foreground/70">自动预览修改中文件</span>
            <Switch
              checked={autoPreviewEnabled}
              onCheckedChange={onAutoPreviewChange}
              className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
            />
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-foreground/70">输出完保持展开</span>
            <Switch
              checked={processGroupsKeepExpanded}
              onCheckedChange={onProcessGroupsKeepExpandedChange}
              className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
