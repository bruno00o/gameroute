import { useTheme } from '@/components/use-theme'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import {
  RiCheckboxCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoopLeftLine,
  RiSpam2Line,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { buttonVariants } from '@/components/ui/button'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="bottom-right"
      className="toaster group"
      closeButton
      containerAriaLabel={m.toast_region()}
      icons={{
        success: <RiCheckboxCircleLine className="text-muted-foreground" />,
        info: <RiInformationLine className="text-muted-foreground" />,
        warning: <RiErrorWarningLine className="text-watch" />,
        error: <RiSpam2Line className="text-critical" />,
        loading: <RiLoopLeftLine className="text-muted-foreground motion-safe:animate-spin" />,
        close: <RiCloseLine className="size-3.5" />,
      }}
      style={
        {
          '--width': '380px',
          '--normal-bg': 'transparent',
          '--normal-bg-hover': 'var(--accent)',
          '--normal-border': 'transparent',
          '--normal-border-hover': 'transparent',
          '--normal-text': 'var(--ink-subtle)',
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: m.toast_close(),
        classNames: {
          toast:
            'flex w-(--width) items-start gap-3 rounded-xl bg-popover py-3 pr-2 pl-4 text-popover-foreground shadow-overlay [&[data-expanded=false][data-front=false]>*]:opacity-0',
          icon: 'flex size-[18px] shrink-0 items-center justify-center [&_svg]:size-[18px]',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'text-ui font-semibold text-foreground',
          description: 'text-ui text-muted-foreground',
          actionButton: buttonVariants({ size: 'sm', className: 'self-center' }),
          cancelButton: buttonVariants({ variant: 'ghost', size: 'sm', className: 'self-center' }),
          closeButton:
            'order-last -mt-0.5 ml-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-subtle outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
