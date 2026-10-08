import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsSectionProps = Omit<React.ComponentProps<'section'>, 'title'> & {
  title: ReactNode
  description?: ReactNode
}

function SettingsSection({
  title,
  description,
  className,
  children,
  ...props
}: SettingsSectionProps) {
  const titleId = useId()

  return (
    <section
      data-slot="settings-section"
      aria-labelledby={titleId}
      className={cn('flex flex-col gap-4 border-t pt-4', className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-heading text-foreground">
          {title}
        </h2>
        {description && (
          <div className="text-ui text-muted-foreground flex max-w-[66ch] flex-col gap-1">
            {description}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

type SettingRowProps = {
  label?: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}

function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div
      data-slot="setting-row"
      className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-2', className)}
    >
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
        {label && <p className="text-ui text-foreground font-[560]">{label}</p>}
        {description && (
          <p
            className={cn(
              'text-muted-foreground max-w-[60ch]',
              label ? 'text-label font-normal' : 'text-ui'
            )}
          >
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export { SettingsSection, SettingRow, type SettingsSectionProps, type SettingRowProps }
