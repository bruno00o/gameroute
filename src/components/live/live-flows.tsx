import type { ReactNode } from 'react'
import { RiBroadcastLine, RiEyeOffLine, RiServerLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import type { LiveStatus, SessionMatch } from '@/types/backend'
import { readingBasis, readingPing } from '@/lib/live'
import { flowServerLabel, formatFlowPing, matchMeasure } from '@/lib/matches'
import { counted } from '@/lib/route-history'
import { getIgnoredConnectionCount } from '@/lib/tauri'
import { Panel } from '@/components/panel'

const IGNORED_REFRESH_MS = 10_000

function FlowRow({
  icon,
  title,
  detail,
  value,
}: {
  icon: ReactNode
  title: string
  detail?: string | null
  value: string
}) {
  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2.5">
      <span aria-hidden="true" className="text-muted-foreground pt-0.5 [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-ui text-foreground font-semibold">{title}</p>
        {detail && (
          <p className="text-data-sm text-ink-subtle font-mono [overflow-wrap:anywhere]">
            {detail}
          </p>
        )}
      </div>
      <p className="text-data text-foreground text-right font-mono tabular-nums">{value}</p>
    </li>
  )
}

type LiveFlowsProps = {
  status: LiveStatus
  match?: SessionMatch
  serverName: string
}

function LiveFlows({ status, match, serverName }: LiveFlowsProps) {
  const { data: ignored } = useQuery({
    queryKey: ['live', 'ignored', status.sessionId],
    queryFn: () => getIgnoredConnectionCount(status.sessionId),
    refetchInterval: status.state === 'frozen' ? false : IGNORED_REFRESH_MS,
  })
  const voice = match?.voice ?? null
  const gameDetail = [
    match ? flowServerLabel(match) : serverName,
    status.primary ? readingBasis(status.primary) : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Panel
      data-slot="live-flows"
      label={m.live_flows_label()}
      title={m.live_flows_title()}
      className="flex-[1_1_300px]"
    >
      <ul className="flex flex-col gap-3.5">
        <FlowRow
          icon={<RiServerLine />}
          title={m.live_flow_game()}
          detail={gameDetail}
          value={readingPing(status.primary)}
        />
        {voice && (
          <FlowRow
            icon={<RiBroadcastLine />}
            title={m.live_flow_voice()}
            detail={flowServerLabel(voice)}
            value={formatFlowPing(matchMeasure(voice))}
          />
        )}
      </ul>
      {ignored ? (
        <div
          data-slot="live-ignored"
          className="mt-3.5 grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-2.5 border-t pt-3"
        >
          <span aria-hidden="true" className="text-muted-foreground pt-0.5 [&_svg]:size-4">
            <RiEyeOffLine />
          </span>
          <p className="text-ui text-muted-foreground">
            {counted(ignored, m.live_flow_ignored_one, m.live_flow_ignored_other)}
          </p>
        </div>
      ) : null}
    </Panel>
  )
}

export { LiveFlows }
