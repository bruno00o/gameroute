import { useEffect, useRef, type ReactNode } from 'react'

import * as m from '@/paraglide/messages'
import { cn } from '@/lib/utils'

type OnboardingStepProps = {
  step: number
  total: number
  title: ReactNode
  children?: ReactNode
  items?: ReactNode[]
  extra?: ReactNode
  primary: ReactNode
  secondary?: ReactNode
  className?: string
}

function OnboardingStep({
  step,
  total,
  title,
  children,
  items,
  extra,
  primary,
  secondary,
  className,
}: OnboardingStepProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [step])

  return (
    <section
      data-slot="onboarding-step"
      aria-labelledby={`onboarding-title-${step}`}
      className={cn(
        'bg-card text-card-foreground flex w-full max-w-[640px] flex-col gap-4 rounded-sm border p-8',
        className
      )}
    >
      <div className="flex flex-col gap-2">
        <p className="text-label text-muted-foreground font-mono font-normal tabular-nums">
          {m.onboarding_step_count({ step: String(step), total: String(total) })}
        </p>
        <ol aria-hidden="true" className="grid auto-cols-fr grid-flow-col gap-0.5">
          {Array.from({ length: total }, (_, index) => (
            <li
              key={index}
              data-state={index + 1 < step ? 'done' : index + 1 === step ? 'current' : 'todo'}
              className={cn(
                'h-1',
                index + 1 < step
                  ? 'bg-line-strong'
                  : index + 1 === step
                    ? 'bg-foreground'
                    : 'bg-border'
              )}
            />
          ))}
        </ol>
      </div>
      <h2
        id={`onboarding-title-${step}`}
        ref={titleRef}
        tabIndex={-1}
        className="text-foreground text-[30px] leading-[34px] font-bold tracking-[-0.015em] font-stretch-[112%] text-balance outline-none"
      >
        {title}
      </h2>
      {children && <p className="text-body text-muted-foreground max-w-[60ch]">{children}</p>}
      {items && items.length > 0 && (
        <ul className="text-body text-muted-foreground marker:text-ink-subtle flex max-w-[60ch] list-disc flex-col gap-1 pl-[18px]">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
      {extra && <div className="flex flex-col gap-3">{extra}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {secondary ?? <span />}
        {primary}
      </div>
    </section>
  )
}

export { OnboardingStep, type OnboardingStepProps }
