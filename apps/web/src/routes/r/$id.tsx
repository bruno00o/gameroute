import { createFileRoute, Link } from '@tanstack/react-router'
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
  return <ReportNotFound id={id} />
}

function ReportNotFound({ id }: { id: string }) {
  return (
    <>
      <section className="gw-wrap flex flex-col items-start gap-5 pt-20 pb-20">
        <h1 className="gw-display">{m.report_title()}</h1>
        <p className="gw-lead">{m.report_text()}</p>
        <p className="gw-small">
          {m.report_id()} <span className="gw-num break-all text-ink">/r/{id}</span>
        </p>
      </section>
      <section className="border-t bg-surface">
        <div className="gw-wrap flex flex-wrap items-center justify-between gap-x-12 gap-y-5 py-14">
          <div className="flex max-w-[620px] flex-col gap-2">
            <h2 className="gw-h3">{m.report_cta_title()}</h2>
            <p className="gw-text">{m.report_cta_text()}</p>
          </div>
          <Link to="/telecharger" className="gr-btn gr-btn--primary gr-btn--lg">
            {m.add_cta()}
          </Link>
        </div>
      </section>
    </>
  )
}
