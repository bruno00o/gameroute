import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-sm border border-line-strong bg-muted px-3 text-ui text-foreground outline-none transition-colors duration-(--dur-instant) ease-standard placeholder:text-ink-subtle file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-label file:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-critical disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        className
      )}
      {...props}
    />
  )
}

export { Input }
