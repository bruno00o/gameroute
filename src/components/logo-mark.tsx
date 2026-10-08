import logoSvg from '@/assets/logo.svg'
import { cn } from '@/lib/utils'

export function LogoMark({ className, style, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-block shrink-0 bg-current', className)}
      style={{ mask: `url("${logoSvg}") center / contain no-repeat`, ...style }}
      {...props}
    />
  )
}
