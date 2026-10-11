import { Link } from '@tanstack/react-router'
import { InfoTip } from '@/components/InfoTip'
import { Small } from '@/components/Typography'
import { Progress, ProgressLabel } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type CollectingIsp,
  MIN_MATCHES,
  MIN_PLAYERS,
  type RankedIsp,
  type Ranking,
  rampColor,
  reliability,
} from '@/data/barometer'
import { formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'

const RELIABILITY = {
  high: m.reliability_high,
  medium: m.reliability_medium,
  low: m.reliability_low,
}

interface Props {
  ranking: Ranking
  gameName: string
}

export function IspRanking({ ranking, gameName }: Props) {
  if (ranking.ranked.length === 0 && ranking.collecting.length === 0) {
    return <RankingEmpty players={ranking.players} gameName={gameName} />
  }

  return (
    <Table className="text-ui">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-24 text-label text-muted-foreground">
            {m.ranking_col_rank()}
          </TableHead>
          <TableHead className="text-label text-muted-foreground">{m.ranking_col_isp()}</TableHead>
          <TableHead className="min-w-[200px] text-label text-muted-foreground">
            {m.ranking_col_clean()}
          </TableHead>
          <TableHead className="text-label text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {m.ranking_col_sample()}
              <InfoTip label={m.ranking_sample_help_label()}>
                {m.ranking_sample_help({ players: MIN_PLAYERS, matches: MIN_MATCHES })}
              </InfoTip>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ranking.ranked.map(isp => (
          <RankedRow key={isp.asn} isp={isp} />
        ))}
        {ranking.collecting.map(isp => (
          <CollectingRow key={isp.name} isp={isp} />
        ))}
      </TableBody>
    </Table>
  )
}

function RankedRow({ isp }: { isp: RankedIsp }) {
  const rank = isp.tied ? m.ranking_tied({ rank: isp.rank }) : String(isp.rank)
  const low = Math.max(0, isp.cleanShare - isp.ciHalfWidth)
  const high = Math.min(100, isp.cleanShare + isp.ciHalfWidth)

  return (
    <TableRow>
      <TableCell className="py-3.5 font-mono text-muted-foreground">{rank}</TableCell>
      <TableCell className="py-3.5">
        <span className="block text-[15px] leading-5 font-semibold">{isp.name}</span>
        <span className="font-mono text-[11px] leading-[14px] text-subtle-foreground">
          {m.ranking_asn({ asn: isp.asn })}
        </span>
      </TableCell>
      <TableCell className="py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-readout text-primary-ink tabular-nums">
            {formatPercent(isp.cleanShare)}
          </span>
          <span className="font-mono text-[11px] leading-[14px] text-subtle-foreground">
            {m.ranking_ci({
              ci: formatNumber(isp.ciHalfWidth, 1),
              reliability: RELIABILITY[reliability(isp.ciHalfWidth)](),
            })}
          </span>
        </div>
        <span
          className="relative mt-2 block h-2 bg-muted ring-1 ring-border ring-inset"
          aria-hidden="true"
        >
          <span
            className={cn('absolute inset-y-0 left-0', rampColor(isp.cleanShare))}
            style={{ width: `${isp.cleanShare}%` }}
          />
          <span
            className="absolute -top-1 h-4 border-x-2 border-foreground"
            style={{ left: `${low}%`, width: `${high - low}%` }}
          >
            <span className="absolute inset-x-0 top-[7px] h-0.5 bg-foreground" />
          </span>
        </span>
      </TableCell>
      <TableCell className="py-3.5 text-muted-foreground">
        {m.ranking_sample({
          players: formatNumber(isp.players),
          matches: formatNumber(isp.matches),
        })}
      </TableCell>
    </TableRow>
  )
}

function CollectingRow({ isp }: { isp: CollectingIsp }) {
  return (
    <TableRow>
      <TableCell className="py-3.5 text-subtle-foreground">{m.ranking_unranked()}</TableCell>
      <TableCell className="py-3.5">
        <span className="block text-[15px] leading-5 font-semibold text-muted-foreground">
          {isp.name}
        </span>
        <span className="text-label text-subtle-foreground">{m.ranking_collecting()}</span>
      </TableCell>
      <TableCell colSpan={2} className="py-3.5">
        <CollectProgress players={isp.players} label={m.ranking_players_needed} />
      </TableCell>
    </TableRow>
  )
}

function CollectProgress({
  players,
  label,
}: {
  players: number
  label: (inputs: { count: string; required: number }) => string
}) {
  return (
    <Progress value={Math.min(players, MIN_PLAYERS)} max={MIN_PLAYERS} className="gap-1.5">
      <ProgressLabel className="text-label font-normal text-muted-foreground">
        {label({ count: formatNumber(players), required: MIN_PLAYERS })}
      </ProgressLabel>
    </Progress>
  )
}

function RankingEmpty({ players, gameName }: { players: number; gameName: string }) {
  return (
    <div className="flex flex-col gap-3 border border-dashed border-border-strong bg-card p-5">
      <p className="text-[15px] leading-5 font-semibold">
        {m.ranking_empty_title({ game: gameName })}
      </p>
      <p className="max-w-[65ch] text-[14px] leading-[21px] text-muted-foreground">
        {m.ranking_empty_text({ game: gameName, players: MIN_PLAYERS, matches: MIN_MATCHES })}
      </p>
      <div className="max-w-[440px]">
        <CollectProgress players={players} label={m.ranking_empty_progress} />
      </div>
      <p className="text-[14px] leading-5">
        <Link to="/telecharger">{m.ranking_empty_cta()}</Link>
      </p>
    </div>
  )
}

export function RankingLegend() {
  return (
    <div className="flex flex-col gap-2">
      <Small className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{m.ranking_ramp_start()}</span>
        <span className="inline-flex gap-0.5" aria-hidden="true">
          <span className="h-3 w-[18px] bg-bar-1" />
          <span className="h-3 w-[18px] bg-bar-2" />
          <span className="h-3 w-[18px] bg-bar-3" />
          <span className="h-3 w-[18px] bg-bar-4" />
          <span className="h-3 w-[18px] bg-bar-5" />
        </span>
        <span>{m.ranking_ramp_end()}</span>
      </Small>
      <Small>{m.ranking_legend({ players: MIN_PLAYERS, matches: MIN_MATCHES })}</Small>
    </div>
  )
}
