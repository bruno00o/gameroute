import type { ReportPayload } from '@gameroute/shared'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Container } from '@/components/Container'
import { LinkButton } from '@/components/LinkButton'
import { Display, Heading, Lead, Small, Text } from '@/components/Typography'
import {
  formatDate,
  gameName,
  matchesLabel,
  reportPeriod,
  verdictHeadline,
  worstMatchSummary,
} from '@/lib/report-text'
import { m } from '@/paraglide/messages'
import { HopTable } from './HopTable'
import { MatchTable } from './MatchTable'
import { RouteStrip } from './RouteStrip'
import { SeverityGlyph } from './SeverityGlyph'

export interface SharedReport {
  id: string
  payload: ReportPayload
  createdAt: string
  expiresAt: string
}

function intro(payload: ReportPayload) {
  const game = gameName(payload)
  if (payload.recipient === 'publisher') return m.report_intro_publisher({ game })
  if (payload.recipient === 'forum') return m.report_intro_forum()
  return payload.isp?.name
    ? m.report_intro_isp({ isp: payload.isp.name })
    : m.report_intro_isp_unknown()
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-overline text-subtle-foreground uppercase font-stretch-88%">{label}</dt>
      <dd className="text-[15px] leading-[22px] font-semibold">{children}</dd>
    </div>
  )
}

export function ReportView({ report }: { report: SharedReport }) {
  const { payload } = report
  const game = gameName(payload)
  const summary = worstMatchSummary(payload)
  const routed = payload.matches.filter(match => match.route)
  const atLeast = payload.matches.some(match => match.pingAtLeast || match.route?.destinationSilent)

  return (
    <>
      <Container className="flex flex-col gap-6 pt-16 pb-12">
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-overline text-subtle-foreground uppercase font-stretch-88%">
            <SeverityGlyph status={payload.verdict.status} size={10} />
            {m.report_label()}
          </p>
          <Display className="max-w-[24ch]">{verdictHeadline(payload)}</Display>
          {summary && <Lead className="tabular-nums">{summary}</Lead>}
          <Text>
            {intro(payload)}{' '}
            {m.report_intro_body({ matches: matchesLabel(payload.matches.length), game })}
          </Text>
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-x-8 gap-y-4 border-y py-5">
          <Fact label={m.report_fact_game()}>{game}</Fact>
          <Fact label={m.report_fact_isp()}>
            {payload.isp?.name ?? m.report_isp_unknown()}
            {payload.isp?.asn != null && (
              <span className="ml-2 font-mono text-[12px] font-normal text-subtle-foreground">
                AS{payload.isp.asn}
              </span>
            )}
          </Fact>
          <Fact label={m.report_fact_period()}>{reportPeriod(payload)}</Fact>
          <Fact label={m.report_fact_matches()}>{matchesLabel(payload.matches.length)}</Fact>
        </dl>
      </Container>

      <section aria-labelledby="matches-title" className="border-t">
        <Container className="flex flex-col gap-4 py-12">
          <Heading id="matches-title">{m.report_matches_title()}</Heading>
          <MatchTable payload={payload} label={m.report_matches_title()} />
        </Container>
      </section>

      {routed.map(match => (
        <section key={match.number} aria-labelledby={`route-${match.number}`} className="border-t">
          <Container className="flex flex-col gap-6 py-12">
            <div className="flex flex-col gap-2">
              <Heading id={`route-${match.number}`}>
                {m.report_route_title({ number: match.number })}
              </Heading>
              <Small>{m.report_route_text()}</Small>
            </div>
            <RouteStrip route={match.route!} />
            <HopTable route={match.route!} label={m.report_hops_label({ number: match.number })} />
          </Container>
        </section>
      ))}

      <section aria-labelledby="notes-title" className="border-t">
        <Container className="flex flex-col gap-3 py-12">
          <Heading id="notes-title" className="text-subheading">
            {m.report_notes_title()}
          </Heading>
          <ul className="flex max-w-[70ch] flex-col gap-2 text-[14px] leading-[22px] text-muted-foreground">
            <li>{m.report_note_source({ version: payload.appVersion })}</li>
            <li>{payload.exactTimes ? m.report_note_exact() : m.report_note_rounded()}</li>
            {atLeast && <li>{m.report_note_at_least()}</li>}
            <li>{m.report_note_expiry({ date: formatDate(report.expiresAt) })}</li>
            <li>
              <Link to="/methode">{m.report_note_method()}</Link>
            </li>
          </ul>
        </Container>
      </section>

      <ReportCta />
    </>
  )
}

export function ReportCta() {
  return (
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
  )
}

export function ReportMissing({ id }: { id: string }) {
  return (
    <>
      <Container className="flex flex-col items-start gap-5 py-20">
        <Display>{m.report_title()}</Display>
        <Lead>{m.report_text()}</Lead>
        <Small>
          {m.report_id()} <span className="font-mono break-all text-foreground">/r/{id}</span>
        </Small>
      </Container>
      <ReportCta />
    </>
  )
}
