import { useId } from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@/lib/utils'

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-muted p-[3px] outline-none transition-colors duration-(--dur-quick) ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-45',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3 rounded-full bg-muted-foreground transition-[translate,background-color] duration-(--dur-quick) ease-standard data-checked:translate-x-3.5 data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

type SwitchFieldProps = SwitchPrimitive.Root.Props & {
  label: React.ReactNode
  description?: React.ReactNode
}

function SwitchField({ id, label, description, className, disabled, ...props }: SwitchFieldProps) {
  const generatedId = useId()
  const switchId = id ?? generatedId
  const descriptionId = description ? `${switchId}-description` : undefined

  return (
    <div
      data-slot="switch-field"
      data-disabled={disabled || undefined}
      className={cn(
        'group/switch-field flex items-start justify-between gap-4 data-disabled:opacity-45',
        className
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={switchId}
          className="cursor-pointer text-ui font-[560] text-foreground group-data-disabled/switch-field:cursor-not-allowed"
        >
          {label}
        </label>
        {description && (
          <p
            id={descriptionId}
            className="mt-0.5 max-w-[52ch] text-label font-normal text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      <Switch
        id={switchId}
        aria-describedby={descriptionId}
        disabled={disabled}
        className="mt-px data-disabled:opacity-100"
        {...props}
      />
    </div>
  )
}

export { Switch, SwitchField, type SwitchFieldProps }
