import { m } from '@/paraglide/messages'
import { Container } from './Container'
import { Display, Lead } from './Typography'

export function ComingSoon({ title }: { title: string }) {
  return (
    <Container className="flex flex-col gap-5 pt-20 pb-24">
      <Display>{title}</Display>
      <Lead>{m.coming_soon()}</Lead>
    </Container>
  )
}
