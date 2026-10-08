import * as m from '@/paraglide/messages'
import { cn } from '@/lib/utils'
import { SeverityGlyph } from '@/components/status/severity-glyph'

export function SilentHop({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'text-muted-foreground inline-flex items-center gap-1.5 font-sans text-xs',
        className
      )}
    >
      <SeverityGlyph status="unmeasured" size={9} />
      {m.hop_silent()}
    </span>
  )
}
