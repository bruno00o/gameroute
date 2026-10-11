import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { MIN_MATCHES, MIN_PLAYERS } from '@/data/barometer'
import { pageHead } from '@/lib/head'
import { REPO_URL } from '@/lib/links'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/methode')({
  head: () => pageHead({ title: m.meta_method_title(), description: m.meta_method_description() }),
  component: MethodPage,
})

type Text = () => string

const SECTIONS: { id: string; title: Text }[] = [
  { id: 'barometre', title: m.method_indicators_title },
  { id: 'sources', title: m.method_sources_title },
  { id: 'echantillons', title: m.method_samples_title },
  { id: 'zones', title: m.method_zones_title },
  { id: 'biais', title: m.method_bias_title },
  { id: 'limites', title: m.method_limits_title },
]

const INDICATORS: [Text, Text, Text][] = [
  [m.method_clean_name, m.method_clean_def, m.method_clean_source],
  [m.method_ping_name, m.method_ping_def, m.method_ping_source],
  [m.method_loss_name, m.method_loss_def, m.method_loss_source],
  [m.method_latency_name, m.method_latency_def, m.method_latency_source],
  [m.method_jitter_name, m.method_jitter_def, m.method_jitter_source],
  [m.method_peak_name, m.method_peak_def, m.method_peak_source],
  [m.method_zones_name, m.method_zones_def, m.method_zones_source],
]

const SOURCES: [Text, Text, Text][] = [
  [m.method_src_probes, m.method_src_probes_what, m.method_src_probes_example],
  [m.method_src_game, m.method_src_game_what, m.method_src_game_example],
  [m.method_src_beacon, m.method_src_beacon_what, m.method_src_beacon_example],
  [m.method_src_capture, m.method_src_capture_what, m.method_src_capture_example],
]

const RELIABILITY: [Text, Text][] = [
  [m.method_reliability_high, m.method_reliability_high_def],
  [m.method_reliability_medium, m.method_reliability_medium_def],
  [m.method_reliability_low, m.method_reliability_low_def],
]

const LIMITS: [Text, Text][] = [
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
      <section className="gw-wrap flex flex-col gap-5 pt-20 pb-14">
        <h1 className="gw-display">{m.method_title()}</h1>
        <p className="gw-lead">{m.method_lead()}</p>
        <p className="gw-small">
          <a href={REPO_URL}>{m.method_code_public()}</a>
        </p>
      </section>

      <div className="gw-wrap flex flex-wrap items-start gap-x-[72px] gap-y-10 pb-[104px]">
        <nav
          aria-labelledby="toc-title"
          className="flex max-w-[240px] flex-[1_1_200px] flex-col gap-2.5 pt-1.5 lg:sticky lg:top-6"
        >
          <p id="toc-title" className="gw-label m-0">
            {m.method_toc()}
          </p>
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm leading-5">
            {SECTIONS.map(section => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title()}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 max-w-[820px] flex-[999_1_560px] flex-col gap-20">
          <Section id="barometre" title={m.method_indicators_title()}>
            <p className="gw-text">{m.method_indicators_text()}</p>
            <Table
              head={[m.method_col_indicator(), m.method_col_definition(), m.method_col_source()]}
              rows={INDICATORS}
            />
            <p className="gw-text">
              <strong>{m.method_never_lead()}</strong> {m.method_never_text()}
            </p>
          </Section>

          <Section id="sources" title={m.method_sources_title()}>
            <p className="gw-text">{m.method_sources_text()}</p>
            <Table
              head={[m.method_col_source(), m.method_col_measured(), m.method_col_written()]}
              rows={SOURCES}
              monoLast
            />
          </Section>

          <Section id="echantillons" title={m.method_samples_title()}>
            <ul className="gw-list">
              <li>{m.method_samples_period()}</li>
              <li>{m.method_samples_min({ players: MIN_PLAYERS, matches: MIN_MATCHES })}</li>
              <li>{m.method_samples_below()}</li>
              <li>{m.method_samples_person()}</li>
            </ul>
            <p className="gw-text">{m.method_samples_ci()}</p>
            <dl className="m-0 grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-[15px] leading-[22px]">
              {RELIABILITY.map(([name, definition]) => (
                <div key={name()} className="contents">
                  <dt className="font-semibold">{name()}</dt>
                  <dd className="m-0 text-ink-muted">{definition()}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="zones" title={m.method_zones_title()}>
            <p className="gw-text">{m.method_zones_text()}</p>
            <ul className="gw-list">
              <li>{m.method_zones_size()}</li>
              <li>{m.method_zones_local()}</li>
              <li>{m.method_zones_precision()}</li>
            </ul>
          </Section>

          <Section id="biais" title={m.method_bias_title()}>
            <ul className="gw-list">
              <li>{m.method_bias_self()}</li>
              <li>{m.method_bias_compare()}</li>
              <li>{m.method_bias_home()}</li>
              <li>{m.method_bias_small()}</li>
            </ul>
          </Section>

          <Section id="limites" title={m.method_limits_title()}>
            <p className="gw-text">{m.method_limits_text()}</p>
            <dl className="m-0 flex flex-col border-b">
              {LIMITS.map(([title, text]) => (
                <div
                  key={title()}
                  className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-8 gap-y-2 border-t py-5"
                >
                  <dt className="gw-h3 text-[17px] leading-6">{title()}</dt>
                  <dd className="gw-text m-0">{text()}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-5">
      <h2 id={`${id}-title`} className="gw-h2">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Table({
  head,
  rows,
  monoLast = false,
}: {
  head: string[]
  rows: [Text, Text, Text][]
  monoLast?: boolean
}) {
  return (
    <div className="gr-table-wrap">
      <table className="gr-table">
        <thead>
          <tr>
            {head.map(label => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, what, source]) => (
            <tr key={name()}>
              <th scope="row">{name()}</th>
              <td className="text-ink-muted">{what()}</td>
              <td className={monoLast ? 'gw-num' : undefined}>{source()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
