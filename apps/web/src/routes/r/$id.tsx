import { createFileRoute, notFound } from '@tanstack/react-router'
import { ReportMissing, ReportView } from '@/components/report/ReportView'
import { pageHead } from '@/lib/head'
import { getReport } from '@/lib/report.functions'
import { gameName, matchesLabel, reportDay, verdictHeadline, verdictShort } from '@/lib/report-text'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'

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
    const en = getLocale() === 'en'
    const image = `${origin}/api/og/r/${report.id}.png${en ? '?lang=en' : ''}`
    const url = `${origin}${en ? '/en' : ''}/r/${report.id}`
    const head = pageHead({ title, description, noindex: true })
    return {
      meta: [
        ...head.meta,
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'GameRoute' },
        { property: 'og:url', content: url },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:image', content: image },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: verdictHeadline(payload) },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
      ],
    }
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
