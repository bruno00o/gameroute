import * as m from '@/paraglide/messages'
import { SUMMARY_DAYS, type GameNetwork } from '@/lib/games'
import { StatusPill } from '@/components/status/status-pill'

export function GameNetworkCell({ network }: { network: GameNetwork }) {
  if (!network.status) {
    return (
      <span className="text-label text-muted-foreground">
        {m.games_network_idle({ days: String(SUMMARY_DAYS) })}
      </span>
    )
  }

  const meta = [network.usual, network.servers].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-0.5 py-2" data-slot="game-network">
      <div className="flex items-baseline gap-2">
        <StatusPill status={network.status} size="sm" />
        {network.ping && (
          <span className="text-data font-mono whitespace-nowrap tabular-nums">{network.ping}</span>
        )}
      </div>
      {meta && <span className="text-label text-muted-foreground">{meta}</span>}
      {network.incident && (
        <span className="text-label text-muted-foreground">{network.incident}</span>
      )}
    </div>
  )
}
