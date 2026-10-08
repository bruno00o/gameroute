import { useId, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { RiArrowDownSLine, RiCloseLine, RiSearchLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { OperatorRoute } from '@/types/backend'
import { formatMs } from '@/lib/format'
import { formatRouteMs, zoneLabel } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { TextField } from '@/components/ui/text-field'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { RouteStrip } from '@/components/route/route-strip'

export const Route = createFileRoute('/help')({
  component: HelpPage,
})

const MAXMIND_URL = 'https://www.maxmind.com'

const EXAMPLE_ROUTE: OperatorRoute = {
  segments: [
    {
      zone: 'home',
      asn: null,
      name: null,
      firstHop: 1,
      lastHop: 2,
      hops: 2,
      silentHops: 0,
      addedMs: 0.7,
      status: null,
    },
    {
      zone: 'isp',
      asn: 15557,
      name: 'SFR',
      firstHop: 3,
      lastHop: 5,
      hops: 3,
      silentHops: 0,
      addedMs: 4.3,
      status: null,
    },
    {
      zone: 'transit',
      asn: 9002,
      name: 'RETN',
      firstHop: 6,
      lastHop: 7,
      hops: 2,
      silentHops: 1,
      addedMs: 12,
      status: null,
    },
  ],
  lastRespondingHop: 7,
  totalMs: 17,
  destinationSilent: true,
  destinationAsn: 6507,
  destinationName: 'Riot Games',
}

type GlossaryEntry = { id: string; term: string; definition: string; mono?: boolean }
type Question = { id: string; question: string; answer: string }

function glossary(): GlossaryEntry[] {
  const levels = [m.status_ok(), m.status_watch(), m.status_degraded(), m.status_critical()]
  return [
    { id: 'ping', term: m.help_term_ping(), definition: m.help_term_ping_desc() },
    { id: 'loss', term: m.help_term_loss(), definition: m.help_term_loss_desc() },
    { id: 'jitter', term: m.help_term_jitter(), definition: m.help_term_jitter_desc() },
    { id: 'hop', term: m.help_term_hop(), definition: m.help_term_hop_desc() },
    { id: 'trace', term: m.help_term_trace(), definition: m.help_term_trace_desc() },
    {
      id: 'at-least',
      term: formatMs(EXAMPLE_ROUTE.totalMs, { digits: 0, atLeast: true }),
      definition: m.help_term_at_least_desc(),
      mono: true,
    },
    { id: 'silent', term: m.hop_silent(), definition: m.help_term_silent_desc() },
    { id: 'rate-limited', term: m.hop_rate_limited(), definition: m.help_term_rate_limited_desc() },
    {
      id: 'problem-hop',
      term: m.help_term_problem_hop(),
      definition: m.help_term_problem_hop_desc(),
    },
    { id: 'home', term: zoneLabel('home'), definition: m.help_term_home_desc() },
    { id: 'isp', term: zoneLabel('isp'), definition: m.help_term_isp_desc() },
    { id: 'transit', term: zoneLabel('transit'), definition: m.help_term_transit_desc() },
    { id: 'service', term: zoneLabel('service'), definition: m.help_term_service_desc() },
    {
      id: 'added',
      term: `+${formatRouteMs(EXAMPLE_ROUTE.segments[2].addedMs)}`,
      definition: m.help_term_added_desc(),
      mono: true,
    },
    { id: 'asn', term: m.help_term_asn(), definition: m.help_term_asn_desc() },
    {
      id: 'status',
      term: m.help_term_status({ levels: levels.join(', ') }),
      definition: m.help_term_status_desc({ why: m.match_why_label() }),
    },
    { id: 'unmeasured', term: m.status_unmeasured(), definition: m.help_term_unmeasured_desc() },
    { id: 'session', term: m.help_term_session(), definition: m.help_term_session_desc() },
    { id: 'match', term: m.help_term_match(), definition: m.help_term_match_desc() },
  ]
}

function questions(): Question[] {
  return [
    { id: 'at-least', question: m.help_faq_at_least_q(), answer: m.help_faq_at_least_a() },
    {
      id: 'router-loss',
      question: m.help_faq_router_loss_q(),
      answer: m.help_faq_router_loss_a({
        rateLimited: m.hop_rate_limited(),
        silent: m.hop_silent_router(),
      }),
    },
    { id: 'measure', question: m.help_faq_measure_q(), answer: m.help_faq_measure_a() },
    {
      id: 'isp',
      question: m.help_faq_isp_q(),
      answer: m.help_faq_isp_a({ copy: m.session_copy_diagnostic() }),
    },
    {
      id: 'add-game',
      question: m.help_faq_add_game_q(),
      answer: m.help_faq_add_game_a({
        games: m.nav_games(),
        add: m.games_add_game(),
        select: m.monitoring_manual_select(),
        start: m.monitoring_start(),
      }),
    },
    {
      id: 'service',
      question: m.help_faq_service_q(),
      answer: m.help_faq_service_a({ restart: m.service_warning_fix() }),
    },
    { id: 'anticheat', question: m.help_faq_anticheat_q(), answer: m.help_faq_anticheat_a() },
    {
      id: 'update',
      question: m.help_faq_update_q(),
      answer: m.help_faq_update_a({ settings: m.nav_settings() }),
    },
    { id: 'data', question: m.help_faq_data_q(), answer: m.help_faq_data_a() },
  ]
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[‘’]/g, "'").toLowerCase()
}

function matcher(query: string) {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return (...texts: string[]) => {
    const haystack = normalize(texts.join(' '))
    return words.every(word => haystack.includes(word))
  }
}

function HelpPage() {
  const [search, setSearch] = useState('')
  const query = search.trim()
  const searching = query.length > 0
  const matches = matcher(query)

  const showHow = matches(m.help_how_title(), m.help_how_body())
  const entries = glossary().filter(entry => matches(entry.term, entry.definition))
  const faq = questions().filter(item => matches(item.question, item.answer))
  const empty = !showHow && entries.length === 0 && faq.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-[980px] flex-col gap-8 px-6 pt-5 pb-8">
        <header className="flex flex-wrap items-end gap-3">
          <h1 className="text-title flex-[1_1_auto]">{m.help_title()}</h1>
          <TextField
            className="max-w-[340px] flex-[1_1_260px]"
            prefix={<RiSearchLine />}
            aria-label={m.help_search_label()}
            placeholder={m.help_search_placeholder()}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </header>

        {showHow && (
          <HelpSection title={m.help_how_title()}>
            <p className="text-body max-w-[65ch]">{m.help_how_body()}</p>
            <Panel label={m.help_how_example()} level={3}>
              <RouteStrip route={EXAMPLE_ROUTE} destination={{ name: 'Riot Games' }} />
            </Panel>
          </HelpSection>
        )}

        {entries.length > 0 && (
          <HelpSection title={m.help_glossary_title()}>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-6">
              {entries.map(entry => (
                <div key={entry.id} className="flex flex-col gap-0.5 border-b py-2.5">
                  <dt
                    className={cn(
                      'text-ui text-foreground font-semibold',
                      entry.mono && 'font-mono font-medium tabular-nums'
                    )}
                  >
                    {entry.term}
                  </dt>
                  <dd className="text-ui text-muted-foreground max-w-[65ch]">{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </HelpSection>
        )}

        {faq.length > 0 && (
          <HelpSection title={m.help_faq_title()}>
            <div className="bg-card divide-y overflow-hidden rounded-sm border">
              {faq.map((item, i) => (
                <FaqItem
                  key={`${item.id}-${searching ? 'search' : 'all'}`}
                  question={item.question}
                  answer={item.answer}
                  defaultOpen={searching || i === 0}
                />
              ))}
            </div>
          </HelpSection>
        )}

        {empty && (
          <EmptyState
            title={m.help_search_empty_title({ query })}
            action={
              <Button size="sm" variant="ghost" onClick={() => setSearch('')}>
                <RiCloseLine data-icon="inline-start" />
                {m.help_search_clear()}
              </Button>
            }
          >
            {m.help_search_empty_hint()}
          </EmptyState>
        )}

        <p className="text-label text-ink-subtle max-w-[72ch] font-normal">
          {m.help_data_attribution({ url: MAXMIND_URL })}
        </p>
      </div>
    </div>
  )
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-heading text-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function FaqItem({
  question,
  answer,
  defaultOpen,
}: {
  question: string
  answer: string
  defaultOpen: boolean
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group/faq text-ui text-foreground hover:bg-accent focus-visible:ring-ring flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2.5 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset">
        {question}
        <RiArrowDownSLine
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-instant) group-data-[panel-open]/faq:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-3.5">
        <p className="text-ui text-muted-foreground max-w-[72ch]">{answer}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}
