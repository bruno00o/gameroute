import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiArrowDownSLine, RiDeleteBinLine, RiSearchLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { GameListItem, ScanResult } from '@/types/backend'
import {
  getGameCount,
  getGames,
  getMonitoredGameCount,
  getServerSummary,
  removeGame,
  scanAllGames,
  scanEpicGames,
  scanRiotGames,
  scanSteamGames,
  searchGameCount,
  searchGames,
  toggleGameMonitored,
} from '@/lib/tauri'
import { formatNumber } from '@/lib/format'
import {
  SUMMARY_DAYS,
  gameNetwork,
  groupServersByGame,
  launcherName,
  profileText,
} from '@/lib/games'
import { errorMessage } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { TextField } from '@/components/ui/text-field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AddGameDialog } from '@/components/add-game-dialog'
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { GameNetworkCell } from '@/components/game-network-cell'
import { Notice } from '@/components/notice'

export const Route = createFileRoute('/games')({
  component: GamesPage,
})

const PAGE_SIZE = 20
const SEARCH_DELAY_MS = 300

type GamesQueryData = { items: GameListItem[]; count: number }

function GamesPage() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const queryClient = useQueryClient()

  const query = useDebouncedValue(search.trim(), SEARCH_DELAY_MS)
  const isSearching = query.length > 0

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['games', page, query],
    queryFn: async (): Promise<GamesQueryData> => {
      const [items, count] = await Promise.all([
        query
          ? searchGames(query, PAGE_SIZE, page * PAGE_SIZE)
          : getGames(PAGE_SIZE, page * PAGE_SIZE),
        query ? searchGameCount(query) : getGameCount(),
      ])
      return { items, count }
    },
  })

  const { data: totals } = useQuery({
    queryKey: ['games-totals'],
    queryFn: async () => {
      const [count, monitored] = await Promise.all([getGameCount(), getMonitoredGameCount()])
      return { count, monitored }
    },
  })

  const { data: summary } = useQuery({
    queryKey: ['server-summary', SUMMARY_DAYS],
    queryFn: () => getServerSummary(SUMMARY_DAYS),
  })

  const serversByGame = useMemo(() => groupServersByGame(summary?.servers ?? []), [summary])

  const games = data?.items ?? []
  const totalCount = data?.count ?? 0

  const refreshGames = () => {
    queryClient.invalidateQueries({ queryKey: ['games'] })
    queryClient.invalidateQueries({ queryKey: ['games-totals'] })
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const handleScan = async (scanFn: () => Promise<ScanResult>) => {
    setIsScanning(true)
    try {
      const result = await scanFn()
      toast.success(
        m.games_scan_success({
          found: String(result.gamesFound),
          added: String(result.gamesAdded),
          updated: String(result.gamesUpdated),
        })
      )
      refreshGames()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsScanning(false)
    }
  }

  const handleToggleMonitored = async (id: number, monitored: boolean) => {
    await queryClient.cancelQueries({ queryKey: ['games'] })

    const previousQueries = queryClient.getQueriesData<GamesQueryData>({ queryKey: ['games'] })

    queryClient.setQueriesData<GamesQueryData>({ queryKey: ['games'] }, old => {
      if (!old) return old
      return {
        ...old,
        items: old.items.map(game => (game.id === id ? { ...game, monitored } : game)),
      }
    })

    try {
      await toggleGameMonitored(id, monitored)
    } catch (err) {
      for (const [queryKey, previous] of previousQueries) {
        queryClient.setQueryData(queryKey, previous)
      }
      toast.error(errorMessage(err))
    } finally {
      refreshGames()
    }
  }

  const handleDeleteGame = async (id: number) => {
    try {
      await removeGame(id)
      toast.success(m.games_deleted())
      refreshGames()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const columns: DataTableColumn<GameListItem>[] = [
    {
      key: 'name',
      label: m.games_col_game(),
      render: game => (
        <div className="flex flex-col gap-0.5 py-2">
          <span className="text-ui font-semibold">{game.name}</span>
          {game.executableName && (
            <span className="text-data-sm text-muted-foreground font-mono">
              {game.executableName}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      label: m.games_col_launcher(),
      render: game => {
        const launcher = launcherName(game.source)
        if (launcher) return launcher
        return (
          <Tooltip>
            <TooltipTrigger className="cursor-default">{m.games_source_manual()}</TooltipTrigger>
            <TooltipContent>{m.games_source_manual_tooltip()}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      key: 'profile',
      label: m.games_col_profile(),
      sortable: false,
      render: game => {
        const profile = profileText(game.profile)
        return (
          <div className="flex max-w-[300px] flex-col gap-0.5 py-2 whitespace-normal">
            <span className="text-label text-foreground font-medium">{profile.title}</span>
            {profile.detail && (
              <span className="text-data-sm text-muted-foreground font-mono">{profile.detail}</span>
            )}
          </div>
        )
      },
    },
    {
      key: 'network',
      label: m.games_col_network(),
      sortable: false,
      render: game => {
        const network = gameNetwork(serversByGame.get(game.name))
        return network && <GameNetworkCell network={network} />
      },
    },
    {
      key: 'monitored',
      label: m.games_col_monitoring(),
      sortable: false,
      render: game => (
        <div className="flex items-center gap-2">
          <Switch
            aria-label={m.games_monitor_label({ name: game.name })}
            checked={game.monitored}
            onCheckedChange={checked => handleToggleMonitored(game.id, checked)}
          />
          <span className="text-label text-muted-foreground" aria-hidden>
            {game.monitored ? m.games_col_monitored() : m.games_monitored_off()}
          </span>
        </div>
      ),
    },
    {
      key: 'actions',
      label: <span className="sr-only">{m.games_delete_game()}</span>,
      sortable: false,
      align: 'end',
      render: game => (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${m.games_delete_game()} ${game.name}`}
              >
                <RiDeleteBinLine />
              </Button>
            }
          />
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{m.games_delete_title()}</AlertDialogTitle>
              <AlertDialogDescription>{m.games_delete_description()}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{m.games_delete_cancel()}</AlertDialogCancel>
              <AlertDialogAction variant="danger" onClick={() => handleDeleteGame(game.id)}>
                {m.games_delete_confirm()}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
    },
  ]

  const scanButton = (
    <div className="flex">
      <Button
        size="sm"
        className="rounded-r-none"
        onClick={() => handleScan(scanAllGames)}
        loading={isScanning}
      >
        {isScanning ? m.games_scan_scanning() : m.games_scan_all()}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isScanning}
          render={
            <Button
              size="sm"
              className="-ml-px rounded-l-none px-1.5"
              disabled={isScanning}
              aria-label={m.games_scan_more()}
            >
              <RiArrowDownSLine />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleScan(scanSteamGames)}>
            {m.games_scan_steam()}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleScan(scanEpicGames)}>
            {m.games_scan_epic()}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleScan(scanRiotGames)}>
            {m.games_scan_riot()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const empty = isSearching ? (
    <EmptyState title={m.search_no_match({ query })} />
  ) : (
    <EmptyState
      title={m.games_empty_title()}
      action={
        <Button size="sm" loading={isScanning} onClick={() => handleScan(scanAllGames)}>
          {m.games_scan_all()}
        </Button>
      }
    >
      {m.games_empty_description()}
    </EmptyState>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
        <header className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
            <h1 className="text-title">{m.page_games_title()}</h1>
            {totals && (
              <p className="text-data-sm text-muted-foreground font-mono tabular-nums">
                {m.games_summary({
                  count: formatNumber(totals.count),
                  monitored: formatNumber(totals.monitored),
                })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {scanButton}
            <AddGameDialog>
              <Button variant="primary" size="sm">
                {m.games_add_game()}
              </Button>
            </AddGameDialog>
          </div>
        </header>

        <TextField
          className="max-w-[380px]"
          prefix={<RiSearchLine />}
          aria-label={m.games_search_label()}
          placeholder={m.games_search_placeholder()}
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
        />

        {isError ? (
          <Notice
            tone="critical"
            title={m.games_loading_error()}
            action={
              <Button size="sm" loading={isFetching} onClick={() => refetch()}>
                {m.games_error_retry()}
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={games}
            loading={isLoading}
            density="comfortable"
            pagination={{
              pageIndex: page,
              pageSize: PAGE_SIZE,
              rowCount: totalCount,
              onPageChange: setPage,
            }}
            empty={empty}
          />
        )}

        <Notice tone="info" title={m.games_notice_title()}>
          {m.games_notice_body()}
        </Notice>
      </div>
    </div>
  )
}
