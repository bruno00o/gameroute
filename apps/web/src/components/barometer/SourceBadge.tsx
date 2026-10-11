import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { m } from '@/paraglide/messages'

export function SourceBadge({ gameMeasured }: { gameMeasured: boolean }) {
  const label = gameMeasured ? m.source_game() : m.source_probes()
  const help = gameMeasured ? m.source_game_help() : m.source_probes_help()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            render={<button type="button" />}
            variant={gameMeasured ? 'default' : 'outline'}
            className="cursor-help text-label"
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent className="text-ui">{help}</TooltipContent>
    </Tooltip>
  )
}
