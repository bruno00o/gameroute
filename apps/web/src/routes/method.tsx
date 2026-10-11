import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Container } from '@/components/Container'
import { Display, Lead, List, Small, Text, Title } from '@/components/Typography'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MIN_MATCHES, MIN_PLAYERS } from '@/data/barometer'
import { pageHead } from '@/lib/head'
import { REPO_URL } from '@/lib/links'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/method')({
  head: () =>
    pageHead({
      title: m.meta_method_title(),
      description: m.meta_method_description(),
      path: '/method',
    }),
  component: MethodPage,
})

type Message = () => string

const SECTIONS: { id: string; title: Message }[] = [
  { id: 'barometer', title: m.method_indicators_title },
  { id: 'sources', title: m.method_sources_title },
  { id: 'samples', title: m.method_samples_title },
  { id: 'zones', title: m.method_zones_title },
  { id: 'bias', title: m.method_bias_title },
  { id: 'limits', title: m.method_limits_title },
]

const INDICATORS: [Message, Message, Message][] = [
  [m.method_clean_name, m.method_clean_def, m.method_clean_source],
  [m.method_ping_name, m.method_ping_def, m.method_ping_source],
  [m.method_loss_name, m.method_loss_def, m.method_loss_source],
  [m.method_latency_name, m.method_latency_def, m.method_latency_source],
  [m.method_jitter_name, m.method_jitter_def, m.method_jitter_source],
  [m.method_peak_name, m.method_peak_def, m.method_peak_source],
  [m.method_zones_name, m.method_zones_def, m.method_zones_source],
]

const SOURCES: [Message, Message, Message][] = [
  [m.method_src_probes, m.method_src_probes_what, m.method_src_probes_example],
  [m.method_src_game, m.method_src_game_what, m.method_src_game_example],
  [m.method_src_beacon, m.method_src_beacon_what, m.method_src_beacon_example],
  [m.method_src_capture, m.method_src_capture_what, m.method_src_capture_example],
]

const RELIABILITY: [Message, Message][] = [
  [m.method_reliability_high, m.method_reliability_high_def],
  [m.method_reliability_medium, m.method_reliability_medium_def],
  [m.method_reliability_low, m.method_reliability_low_def],
]

const LIMITS: [Message, Message][] = [
  [m.method_limit_silent, m.method_limit_silent_text],
  [m.method_limit_city, m.method_limit_city_text],
  [m.method_limit_return, m.method_limit_return_text],
  [m.method_limit_cause, m.method_limit_cause_text],
  [m.method_limit_home, m.method_limit_home_text],
  [m.method_limit_load, m.method_limit_load_text],
  [m.method_limit_beacon, m.method_limit_beacon_text],
]

function MethodPage() {
  return (
    <>
      <Container className="flex flex-col gap-5 pt-20 pb-14">
        <Display>{m.method_title()}</Display>
        <Lead>{m.method_lead()}</Lead>
        <Small>
          <a href={REPO_URL}>{m.method_code_public()}</a>
        </Small>
      </Container>

      <Container className="flex flex-wrap items-start gap-x-[72px] gap-y-10 pb-[104px]">
        <nav
          aria-labelledby="toc-title"
          className="flex max-w-[240px] flex-[1_1_200px] flex-col gap-2.5 pt-1.5 lg:sticky lg:top-6"
        >
          <p id="toc-title" className="text-label text-muted-foreground">
            {m.method_toc()}
          </p>
          <ol className="flex flex-col gap-2.5 text-[14px] leading-5">
            {SECTIONS.map(section => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title()}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 max-w-[820px] flex-[999_1_560px] flex-col gap-20">
          <Section id="barometer" title={m.method_indicators_title()}>
            <Text>{m.method_indicators_text()}</Text>
            <MethodTable
              head={[m.method_col_indicator(), m.method_col_definition(), m.method_col_source()]}
              rows={INDICATORS}
            />
            <Text>
              <strong className="font-semibold text-foreground">{m.method_never_lead()}</strong>{' '}
              {m.method_never_text()}
            </Text>
          </Section>

          <Section id="sources" title={m.method_sources_title()}>
            <Text>{m.method_sources_text()}</Text>
            <MethodTable
              head={[m.method_col_source(), m.method_col_measured(), m.method_col_written()]}
              rows={SOURCES}
              monoLast
            />
          </Section>

          <Section id="samples" title={m.method_samples_title()}>
            <List>
              <li>{m.method_samples_period()}</li>
              <li>{m.method_samples_min({ players: MIN_PLAYERS, matches: MIN_MATCHES })}</li>
              <li>{m.method_samples_below()}</li>
              <li>{m.method_samples_person()}</li>
            </List>
            <Text>{m.method_samples_ci()}</Text>
            <dl className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-body">
              {RELIABILITY.map(([name, definition]) => (
                <div key={name()} className="contents">
                  <dt className="font-semibold">{name()}</dt>
                  <dd className="text-muted-foreground">{definition()}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="zones" title={m.method_zones_title()}>
            <Text>{m.method_zones_text()}</Text>
            <List>
              <li>{m.method_zones_size()}</li>
              <li>{m.method_zones_local()}</li>
              <li>{m.method_zones_precision()}</li>
            </List>
          </Section>

          <Section id="bias" title={m.method_bias_title()}>
            <List>
              <li>{m.method_bias_self()}</li>
              <li>{m.method_bias_compare()}</li>
              <li>{m.method_bias_home()}</li>
              <li>{m.method_bias_small()}</li>
            </List>
          </Section>

          <Section id="limits" title={m.method_limits_title()}>
            <Text>{m.method_limits_text()}</Text>
            <dl className="flex flex-col border-b">
              {LIMITS.map(([title, text]) => (
                <div
                  key={title()}
                  className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-8 gap-y-2 border-t py-5"
                >
                  <dt className="text-subheading font-stretch-106%">{title()}</dt>
                  <dd className="text-body text-muted-foreground">{text()}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </Container>
    </>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-5">
      <Title id={`${id}-title`}>{title}</Title>
      {children}
    </section>
  )
}

function MethodTable({
  head,
  rows,
  monoLast = false,
}: {
  head: string[]
  rows: [Message, Message, Message][]
  monoLast?: boolean
}) {
  return (
    <div className="border bg-card">
      <Table className="text-ui">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {head.map(label => (
              <TableHead key={label} scope="col" className="px-3 text-label text-muted-foreground">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([name, what, source]) => (
            <TableRow key={name()} className="hover:bg-transparent">
              <TableHead
                scope="row"
                className="h-auto min-w-[140px] px-3 py-3 align-top font-semibold whitespace-normal"
              >
                {name()}
              </TableHead>
              <TableCell className="px-3 py-3 align-top whitespace-normal text-muted-foreground">
                {what()}
              </TableCell>
              <TableCell
                className={`px-3 py-3 align-top whitespace-normal ${monoLast ? 'font-mono' : ''}`}
              >
                {source()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
