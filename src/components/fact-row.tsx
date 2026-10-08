import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function FactRow({ className, ...props }: React.ComponentProps<'dl'>) {
  return (
    <dl
      data-slot="fact-row"
      className={cn('flex flex-wrap gap-x-8 gap-y-3', className)}
      {...props}
    />
  )
}

type FactProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  label: ReactNode
  hint?: ReactNode
  detail?: ReactNode
  children?: ReactNode
}

function Fact({ label, hint, detail, className, children, ...props }: FactProps) {
  const missing = children == null || children === false || children === ''

  return (
    <div data-slot="fact" className={cn('flex min-w-0 flex-col gap-0.5', className)} {...props}>
      <dt className="text-label text-muted-foreground font-stretch-[92%]">
        {hint ? (
          <Tooltip>
            <TooltipTrigger className="cursor-help text-left underline decoration-dotted underline-offset-2">
              {label}
            </TooltipTrigger>
            <TooltipContent side="bottom">{hint}</TooltipContent>
          </Tooltip>
        ) : (
          label
        )}
      </dt>
      <dd
        className={cn(
          'text-heading flex flex-wrap items-baseline gap-x-2 font-mono font-medium tabular-nums',
          missing ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {missing ? '—' : children}
      </dd>
      {detail && <dd className="text-label text-ink-subtle font-normal">{detail}</dd>}
    </div>
  )
}

export { FactRow, Fact, type FactProps }
