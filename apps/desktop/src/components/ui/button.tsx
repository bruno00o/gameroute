import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { RiLoopLeftLine } from '@remixicon/react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-sm border border-transparent bg-clip-padding font-[560] outline-none select-none transition-colors duration-(--dur-instant) ease-standard focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-invalid:border-critical [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-action-hover aria-expanded:bg-action-hover',
        secondary:
          'border-line-strong bg-card text-foreground hover:bg-accent aria-expanded:bg-accent',
        ghost:
          'text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
        danger: 'bg-critical-soft text-critical hover:border-critical',
      },
      size: {
        sm: "h-7 gap-1.5 px-2.5 text-label [&_svg:not([class*='size-'])]:size-3.5",
        md: 'h-8 gap-2 px-3 text-ui',
        lg: 'h-10 gap-2 px-4 text-body',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        icon: 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean
  }

function Button({
  className,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        buttonVariants({ variant, size }),
        loading &&
          'disabled:cursor-progress disabled:opacity-100 [&>svg:not([data-slot=spinner])]:hidden',
        className
      )}
      {...props}
    >
      {loading && (
        <RiLoopLeftLine data-slot="spinner" aria-hidden className="motion-safe:animate-spin" />
      )}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants, type ButtonProps }
