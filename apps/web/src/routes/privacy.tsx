import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/ComingSoon'
import { pageHead } from '@/lib/head'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/privacy')({
  head: () => pageHead({ title: m.meta_privacy_title(), path: '/privacy', noindex: true }),
  component: () => <ComingSoon title={m.privacy_title()} />,
})
