import { RiCloseLine, RiMenuLine } from '@remixicon/react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { m } from '@/paraglide/messages'
import { Container } from './Container'
import { LinkButton } from './LinkButton'
import { Logo } from './Logo'

const NAV_LINK =
  'text-[14px] leading-5 font-medium text-muted-foreground no-underline hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-primary aria-[current=page]:underline-offset-[6px]'

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Link to="/" activeOptions={{ exact: true }} className={NAV_LINK} onClick={onNavigate}>
        {m.nav_barometer()}
      </Link>
      <Link to="/methode" className={NAV_LINK} onClick={onNavigate}>
        {m.nav_method()}
      </Link>
    </>
  )
}

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <header className="border-b bg-card">
      <Container className="flex min-h-[68px] items-center justify-between gap-6 py-3">
        <Link to="/" aria-label={m.nav_home()} className="flex items-center gap-2.5 no-underline">
          <Logo />
          <span className="text-[17px] leading-none font-bold tracking-[-0.01em] text-foreground font-stretch-112%">
            GameRoute
          </span>
        </Link>
        <nav aria-label={m.nav_label()} className="hidden items-center gap-7 md:flex">
          <NavLinks />
          <LinkButton to="/telecharger">{m.nav_download()}</LinkButton>
        </nav>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="icon" className="md:hidden" />}
            aria-label={m.nav_open_menu()}
          >
            <RiMenuLine aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="right" showCloseButton={false} className="gap-6 p-6">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-heading font-stretch-106%">GameRoute</SheetTitle>
              <SheetClose
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label={m.nav_close_menu()}
              >
                <RiCloseLine aria-hidden="true" />
              </SheetClose>
            </div>
            <nav aria-label={m.nav_label()} className="flex flex-col items-start gap-5">
              <NavLinks onNavigate={close} />
              <LinkButton to="/telecharger" size="lg" onClick={close}>
                {m.nav_download()}
              </LinkButton>
            </nav>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  )
}
