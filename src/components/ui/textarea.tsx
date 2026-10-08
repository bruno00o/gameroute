import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content flex min-h-16 w-full rounded-sm border border-line-strong bg-muted px-3 py-2 text-ui text-foreground outline-none transition-colors duration-(--dur-instant) ease-standard placeholder:text-ink-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-critical disabled:cursor-not-allowed disabled:opacity-45',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
