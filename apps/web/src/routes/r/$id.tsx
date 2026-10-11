import { createFileRoute } from '@tanstack/react-router'
import { Container } from '@/components/Container'
import { Display, Heading, Lead, Small, Text } from '@/components/Typography'
import { LinkButton } from '@/components/LinkButton'
import { pageHead } from '@/lib/head'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/r/$id')({
  head: () =>
    pageHead({
      title: m.meta_report_title(),
      description: m.meta_report_description(),
      noindex: true,
    }),
  component: ReportPage,
})

function ReportPage() {
  const { id } = Route.useParams()

  return (
    <>
      <Container className="flex flex-col items-start gap-5 py-20">
        <Display>{m.report_title()}</Display>
        <Lead>{m.report_text()}</Lead>
        <Small>
          {m.report_id()} <span className="font-mono break-all text-foreground">/r/{id}</span>
        </Small>
      </Container>
      <section className="border-t bg-card">
        <Container className="flex flex-wrap items-center justify-between gap-x-12 gap-y-5 py-14">
          <div className="flex max-w-[620px] flex-col gap-2">
            <Heading>{m.report_cta_title()}</Heading>
            <Text>{m.report_cta_text()}</Text>
          </div>
          <LinkButton to="/telecharger" size="lg">
            {m.add_cta()}
          </LinkButton>
        </Container>
      </section>
    </>
  )
}
