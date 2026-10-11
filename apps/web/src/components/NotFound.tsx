import { Link } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'
import { Container } from './Container'
import { Display, Lead } from './Typography'

export function NotFound() {
  return (
    <Container className="flex flex-col items-start gap-5 pt-20 pb-24">
      <Display>{m.not_found_title()}</Display>
      <Lead>{m.not_found_text()}</Lead>
      <Link to="/" className="text-body">
        {m.not_found_home()}
      </Link>
    </Container>
  )
}
