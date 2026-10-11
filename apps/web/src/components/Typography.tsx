import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Display({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 className={cn('text-display font-stretch-112% text-balance', className)} {...props} />
}

export function Title({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-title font-stretch-106% text-balance', className)} {...props} />
}

export function Heading({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-heading font-stretch-106% text-balance', className)} {...props} />
}

export function Lead({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('max-w-[60ch] text-lead text-muted-foreground text-pretty', className)}
      {...props}
    />
  )
}

export function Text({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('max-w-[65ch] text-body text-muted-foreground text-pretty', className)}
      {...props}
    />
  )
}

export function Small({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p className={cn('text-[13px] leading-[19px] text-subtle-foreground', className)} {...props} />
  )
}

export function List({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      className={cn(
        'flex max-w-[65ch] list-disc flex-col gap-2.5 pl-5 text-body text-muted-foreground marker:text-subtle-foreground',
        className
      )}
      {...props}
    />
  )
}

export function OrderedList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        'flex max-w-[65ch] list-decimal flex-col gap-2.5 pl-5 text-body text-muted-foreground marker:text-subtle-foreground',
        className
      )}
      {...props}
    />
  )
}
