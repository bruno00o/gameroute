import { Link } from '@tanstack/react-router'
import {
  type CollectingIsp,
  MIN_MATCHES,
  MIN_PLAYERS,
  type RankedIsp,
  type Ranking,
  rampClass,
  reliability,
} from '@/data/barometer'
import { formatNumber, formatPercent } from '@/lib/format'
import { m } from '@/paraglide/messages'

const RELIABILITY = {
  high: m.reliability_high,
  medium: m.reliability_medium,
  low: m.reliability_low,
}

const ROW =
  'grid grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 border-b py-3.5'

interface Props {
  ranking: Ranking
  gameName: string
}

export function IspRanking({ ranking, gameName }: Props) {
  if (ranking.ranked.length === 0 && ranking.collecting.length === 0) {
    return <RankingEmpty players={ranking.players} gameName={gameName} />
  }

  return (
    <ol className="m-0 flex list-none flex-col border-t p-0">
      {ranking.ranked.map(isp => (
        <RankedRow key={isp.asn} isp={isp} />
      ))}
      {ranking.collecting.map(isp => (
        <CollectingRow key={isp.name} isp={isp} />
      ))}
    </ol>
  )
}

function RankedRow({ isp }: { isp: RankedIsp }) {
  const rank = isp.tied ? m.ranking_tied({ rank: isp.rank }) : String(isp.rank)
  const low = Math.max(0, isp.cleanShare - isp.ciHalfWidth)
  const high = Math.min(100, isp.cleanShare + isp.ciHalfWidth)

  return (
    <li className={ROW}>
      <span className="gw-num text-[13px] text-ink-muted">{rank}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] leading-5 font-semibold">{isp.name}</span>
        <span className="gw-num text-[11px] leading-[14px] text-ink-subtle">
          {m.ranking_isp_meta({
            asn: isp.asn,
            players: formatNumber(isp.players),
            matches: formatNumber(isp.matches),
          })}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <span className="gw-big">{formatPercent(isp.cleanShare)}</span>
        <span className="gw-num text-[11px] leading-[14px] text-ink-subtle">
          {m.ranking_ci({
            ci: formatNumber(isp.ciHalfWidth, 1),
            reliability: RELIABILITY[reliability(isp.ciHalfWidth)](),
          })}
        </span>
      </span>
      <span className="gw-track col-[2/-1]" aria-hidden="true">
        <span
          className={`gw-fill ${rampClass(isp.cleanShare)}`}
          style={{ width: `${isp.cleanShare}%` }}
        />
        <span className="gw-ci" style={{ left: `${low}%`, width: `${high - low}%` }} />
      </span>
    </li>
  )
}

function CollectingRow({ isp }: { isp: CollectingIsp }) {
  return (
    <li className={ROW}>
      <span className="text-[13px] text-ink-subtle">{m.ranking_unranked()}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] leading-5 font-semibold text-ink-muted">{isp.name}</span>
        <span className="text-xs text-ink-subtle">{m.ranking_collecting()}</span>
      </span>
      <span className="text-right text-xs text-ink-muted">
        {m.ranking_players_needed({ count: formatNumber(isp.players), required: MIN_PLAYERS })}
      </span>
      <Progress value={isp.players} max={MIN_PLAYERS} className="col-[2/-1]" />
    </li>
  )
}

function RankingEmpty({ players, gameName }: { players: number; gameName: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[3px] border border-dashed border-line-strong p-5">
      <p className="m-0 text-[15px] leading-5 font-semibold">
        {m.ranking_empty_title({ game: gameName })}
      </p>
      <p className="gw-text text-sm leading-[21px]">
        {m.ranking_empty_text({ game: gameName, players: MIN_PLAYERS, matches: MIN_MATCHES })}
      </p>
      <div className="flex max-w-[440px] flex-col gap-1.5">
        <p className="m-0 text-xs text-ink-muted">
          {m.ranking_empty_progress({ count: formatNumber(players), required: MIN_PLAYERS })}
        </p>
        <Progress value={players} max={MIN_PLAYERS} />
      </div>
      <p className="m-0 text-sm leading-5">
        <Link to="/telecharger">{m.ranking_empty_cta()}</Link>
      </p>
    </div>
  )
}

function Progress({ value, max, className }: { value: number; max: number; className?: string }) {
  const width = `${Math.min(100, Math.round((value / max) * 100))}%`
  return (
    <span className={`gw-progress block ${className ?? ''}`} aria-hidden="true">
      <span style={{ width }} />
    </span>
  )
}

export function RankingLegend() {
  return (
    <div className="flex flex-col gap-2">
      <p className="gw-small flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{m.ranking_ramp_start()}</span>
        <span className="gw-ramp" aria-hidden="true">
          <span className="gw-q1" />
          <span className="gw-q2" />
          <span className="gw-q3" />
          <span className="gw-q4" />
          <span className="gw-q5" />
        </span>
        <span>{m.ranking_ramp_end()}</span>
      </p>
      <p className="gw-small">{m.ranking_legend({ players: MIN_PLAYERS, matches: MIN_MATCHES })}</p>
    </div>
  )
}
