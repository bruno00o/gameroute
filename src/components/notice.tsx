import { RiAlertLine, RiErrorWarningLine, RiInformationLine, RiSpam2Line } from '@remixicon/react'
import { cva } from 'class-variance-authority'

import { cn } from '@/lib/utils'

type NoticeTone = 'info' | 'watch' | 'degraded' | 'critical' | 'unmeasured'

const noticeVariants = cva('flex items-start gap-3 text-foreground', {
  variants: {
    tone: {
      info: 'bg-muted',
      watch: 'bg-watch-soft',
      degraded: 'bg-degraded-soft',
      critical: 'bg-critical-soft',
      unmeasured: 'bg-unmeasured-soft',
    },
    banner: {
      true: 'items-center rounded-none px-4 py-2',
      false: 'rounded-sm px-4 py-3',
    },
  },
  defaultVariants: {
    tone: 'info',
    banner: false,
  },
})

const toneIcons = {
  info: { Icon: RiInformationLine, className: 'text-muted-foreground' },
  watch: { Icon: RiErrorWarningLine, className: 'text-watch' },
  degraded: { Icon: RiAlertLine, className: 'text-degraded' },
  critical: { Icon: RiSpam2Line, className: 'text-critical' },
  unmeasured: { Icon: RiInformationLine, className: 'text-unmeasured' },
} satisfies Record<NoticeTone, { Icon: React.ElementType; className: string }>

type NoticeProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  tone?: NoticeTone
  title?: React.ReactNode
  action?: React.ReactNode
  banner?: boolean
}

function Notice({
  tone = 'info',
  title,
  action,
  banner = false,
  className,
  children,
  ...props
}: NoticeProps) {
  const { Icon, className: iconClassName } = toneIcons[tone]

  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cn(noticeVariants({ tone, banner }), className)}
      {...props}
    >
      <Icon aria-hidden className={cn('size-4 shrink-0', !banner && 'mt-px', iconClassName)} />
      <div className={cn('min-w-0 flex-1', banner && 'flex flex-wrap items-baseline gap-x-2')}>
        {title && <p className="text-ui font-semibold text-foreground">{title}</p>}
        {children && (
          <div
            className={cn(
              'max-w-[72ch] text-ui text-muted-foreground',
              !banner && title && 'mt-0.5'
            )}
          >
            {children}
          </div>
        )}
      </div>
      {action && <div className="flex shrink-0 gap-2 self-center">{action}</div>}
    </div>
  )
}

export { Notice, type NoticeProps, type NoticeTone }
