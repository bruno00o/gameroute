import { createFileRoute, notFound } from '@tanstack/react-router'
import { ReportMissing, ReportView } from '@/components/report/ReportView'
import { langQuery, pageHead } from '@/lib/head'
import { getReport } from '@/lib/report.functions'
import { gameName, matchesLabel, reportDay, verdictHeadline, verdictShort } from '@/lib/report-text'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/r/$id')({
  loader: async ({ params }) => {
    const { origin, report } = await getReport({ data: params.id })
    if (!report) throw notFound()
    return { origin, report }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return pageHead({ title: m.report_title(), noindex: true })
    const { origin, report } = loaderData
    const { payload } = report
    const game = gameName(payload)
    const title = m.report_meta_title({ game, verdict: verdictShort(payload) })
    const description = m.report_meta_description({
      matches: matchesLabel(payload.matches.length),
      game,
      day: reportDay(payload),
    })
    return pageHead({
      title,
      description,
      path: `/r/${report.id}`,
      image: {
        url: `${origin}/api/og/r/${report.id}.png${langQuery()}`,
        alt: verdictHeadline(payload),
      },
      noindex: true,
    })
  },
  component: ReportPage,
  notFoundComponent: MissingReportPage,
})

function ReportPage() {
  const { report } = Route.useLoaderData()
  return <ReportView report={report} />
}

function MissingReportPage() {
  const { id } = Route.useParams()
  return <ReportMissing id={id} />
}
