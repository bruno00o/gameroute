import { RiInformationLine } from '@remixicon/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function InfoTip({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            className="text-subtle-foreground"
          />
        }
      >
        <RiInformationLine aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="text-ui">{children}</TooltipContent>
    </Tooltip>
  )
}
