import { createLink, type LinkComponent } from '@tanstack/react-router'
import type { VariantProps } from 'class-variance-authority'
import { type ComponentProps, forwardRef } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ButtonStyle = VariantProps<typeof buttonVariants>

type AnchorButtonProps = ComponentProps<'a'> & ButtonStyle

export const AnchorButton = forwardRef<HTMLAnchorElement, AnchorButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <a
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
)

const RouterAnchorButton = createLink(AnchorButton)

export const LinkButton: LinkComponent<typeof AnchorButton> = props => (
  <RouterAnchorButton preload="intent" {...props} />
)
