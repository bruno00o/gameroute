import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type EmptyStateProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: ReactNode
  action?: ReactNode
  compact?: boolean
}

function EmptyState({
  title,
  action,
  compact = false,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-start gap-1 text-left', className)}
      {...props}
    >
      <p
        className={cn('text-foreground font-semibold', compact ? 'text-ui' : 'text-body leading-5')}
      >
        {title}
      </p>
      {children && <p className="text-ui text-muted-foreground max-w-[60ch]">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export { EmptyState, type EmptyStateProps }
