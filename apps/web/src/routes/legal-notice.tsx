import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/ComingSoon'
import { pageHead } from '@/lib/head'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/legal-notice')({
  head: () => pageHead({ title: m.meta_legal_title() }),
  component: () => <ComingSoon title={m.legal_title()} />,
})
