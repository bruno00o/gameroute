import { useState } from 'react'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'

import { cn } from '@/lib/utils'

type SegmentedOption<T extends string> = {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
}

type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
}

function Segmented<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  disabled,
  className,
}: SegmentedProps<T>) {
  const [uncontrolled, setUncontrolled] = useState<T | undefined>(defaultValue ?? options[0]?.value)
  const current = value ?? uncontrolled

  const handleValueChange = (next: T[]) => {
    const picked = next.find(item => item !== current)
    if (picked === undefined) return
    if (value === undefined) setUncontrolled(picked)
    onValueChange?.(picked)
  }

  return (
    <ToggleGroup<T>
      data-slot="segmented"
      aria-label={label}
      value={current === undefined ? [] : [current]}
      onValueChange={handleValueChange}
      disabled={disabled}
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-sm border border-border bg-muted p-0.5 data-disabled:opacity-45',
        className
      )}
    >
      {options.map(option => (
        <Toggle<T>
          key={option.value}
          value={option.value}
          data-slot="segmented-option"
          className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[2px] px-2.5 text-label font-[560] text-muted-foreground outline-none transition-colors duration-(--dur-instant) ease-standard select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-pressed:bg-surface-raised data-pressed:text-foreground data-pressed:shadow-[0_0_0_1px_var(--line-strong)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
        >
          {option.icon}
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export { Segmented, type SegmentedOption, type SegmentedProps }
