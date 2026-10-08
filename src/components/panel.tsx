import { useId, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PanelProps = Omit<React.ComponentProps<'section'>, 'title'> & {
  label?: ReactNode
  title?: ReactNode
  action?: ReactNode
  footer?: ReactNode
  tone?: 'default' | 'sunken'
  interactive?: boolean
  flush?: boolean
  level?: 2 | 3
}

function Panel({
  label,
  title,
  action,
  footer,
  tone = 'default',
  interactive = false,
  flush = false,
  level = 2,
  className,
  children,
  onKeyDown,
  ...props
}: PanelProps) {
  const labelId = useId()
  const Heading = level === 3 ? 'h3' : 'h2'
  const hasHeader = Boolean(label || title || action)

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event)
    if (!interactive || event.defaultPrevented || event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.currentTarget.click()
    }
  }

  return (
    <section
      data-slot="panel"
      data-tone={tone}
      aria-labelledby={label ? labelId : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'bg-card text-card-foreground min-w-0 rounded-sm border',
        tone === 'sunken' && 'bg-muted',
        interactive &&
          'hover:bg-surface-raised cursor-pointer transition-colors duration-(--dur-instant)',
        className
      )}
      {...props}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            {label && (
              <Heading id={labelId} className="text-heading text-foreground text-balance">
                {label}
              </Heading>
            )}
            {title && <p className="text-ui text-muted-foreground mt-0.5 tabular-nums">{title}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </header>
      )}
      <div
        data-slot="panel-body"
        className={cn(
          flush
            ? cn(
                hasHeader && 'mt-3 [&>[data-slot=data-table]>[data-slot=data-table-empty]]:pt-0',
                '[&>[data-slot=data-table]]:rounded-none [&>[data-slot=data-table]]:border-0'
              )
            : cn('px-4 pb-4', hasHeader ? 'pt-3' : 'pt-4')
        )}
      >
        {children}
      </div>
      {footer && (
        <footer className="text-label text-ink-subtle flex items-center justify-between gap-3 border-t px-4 py-2 font-normal">
          {footer}
        </footer>
      )}
    </section>
  )
}

export { Panel, type PanelProps }
