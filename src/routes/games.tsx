import { useCallback, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiSearchLine,
  RiSteamLine,
} from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { GameListItem, ScanResult } from '@/types/backend'
import {
  getGameCount,
  getGames,
  removeGame,
  scanAllGames,
  scanEpicGames,
  scanRiotGames,
  scanSteamGames,
  searchGameCount,
  searchGames,
  toggleGameMonitored,
} from '@/lib/tauri'
import { formatDate, formatDuration, formatNumber } from '@/lib/format'
import { errorMessage } from '@/lib/utils'
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

export const Route = createFileRoute('/games')({
  component: GamesPage,
})

const PAGE_SIZE = 20

function GamesPage() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const queryClient = useQueryClient()
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(0)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])

  const query = debouncedSearch.trim()
  const isSearching = query.length > 0

  const { data, isLoading, isError } = useQuery({
    queryKey: ['games', page, debouncedSearch],
    queryFn: async () => {
      const [items, count] = await Promise.all([
        query
          ? searchGames(query, PAGE_SIZE, page * PAGE_SIZE)
          : getGames(PAGE_SIZE, page * PAGE_SIZE),
        query ? searchGameCount(query) : getGameCount(),
      ])
      return { items, count }
    },
  })

  const games = data?.items ?? []
  const totalCount = data?.count ?? 0

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
      queryClient.invalidateQueries({ queryKey: ['games'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsScanning(false)
    }
  }

  const handleToggleMonitored = async (id: number, monitored: boolean) => {
    // Cancel any in-flight queries so they don't overwrite our optimistic update
    await queryClient.cancelQueries({ queryKey: ['games'] })

    // Snapshot all current games query caches for rollback
    const previousQueries = queryClient.getQueriesData<{ items: GameListItem[]; count: number }>({
      queryKey: ['games'],
    })

    // Optimistically update every cached games query
    queryClient.setQueriesData<{ items: GameListItem[]; count: number }>(
      { queryKey: ['games'] },
      old => {
        if (!old) return old
        return {
          ...old,
          items: old.items.map(game => (game.id === id ? { ...game, monitored } : game)),
        }
      }
    )

    try {
      await toggleGameMonitored(id, monitored)
    } catch (err) {
      // Rollback all cached queries to their previous state
      for (const [queryKey, data] of previousQueries) {
        queryClient.setQueryData(queryKey, data)
      }
      toast.error(errorMessage(err))
    } finally {
      queryClient.invalidateQueries({ queryKey: ['games'] })
    }
  }

  const handleDeleteGame = async (id: number) => {
    try {
      await removeGame(id)
      toast.success(m.games_deleted())
      queryClient.invalidateQueries({ queryKey: ['games'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const columns: DataTableColumn<GameListItem>[] = [
    {
      key: 'name',
      label: m.games_col_name(),
      render: game => (
        <div>
          <span className="font-medium">{game.name}</span>
          {game.executableName && (
            <span className="text-muted-foreground block text-xs">{game.executableName}</span>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      label: m.games_col_source(),
      render: game => {
        if (game.source === 'manual') {
          return (
            <Tooltip>
              <TooltipTrigger className="cursor-default">{m.games_source_manual()}</TooltipTrigger>
              <TooltipContent>{m.games_source_manual_tooltip()}</TooltipContent>
            </Tooltip>
          )
        }
        return game.source === 'steam' ? 'Steam' : game.source === 'epic' ? 'Epic' : game.source
      },
    },
    {
      key: 'sessionCount',
      label: m.games_col_sessions(),
      align: 'end',
      mono: true,
      render: game => (game.sessionCount > 0 ? formatNumber(game.sessionCount) : null),
    },
    {
      key: 'totalPlayTimeSecs',
      label: m.games_col_play_time(),
      align: 'end',
      mono: true,
      render: game => (game.totalPlayTimeSecs > 0 ? formatDuration(game.totalPlayTimeSecs) : null),
    },
    {
      key: 'monitored',
      label: m.games_col_monitored(),
      render: game => (
        <Switch
          aria-label={m.games_col_monitored()}
          checked={game.monitored}
          onCheckedChange={checked => handleToggleMonitored(game.id, checked)}
        />
      ),
    },
    {
      key: 'lastPlayedAt',
      label: m.games_col_last_played(),
      render: game => (game.lastPlayedAt ? formatDate(game.lastPlayedAt) : null),
    },
    {
      key: 'actions',
      label: <span className="sr-only">{m.games_delete_game()}</span>,
      align: 'end',
      render: game => (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={m.games_delete_game()}>
                <RiDeleteBinLine className="size-3.5" />
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

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{m.page_games_title()}</h1>
          <p className="text-muted-foreground mt-2">{m.page_games_description()}</p>
        </div>
        <div className="flex gap-2">
          <div className="flex">
            <Button
              size="sm"
              className="rounded-r-none"
              onClick={() => handleScan(scanAllGames)}
              disabled={isScanning}
            >
              {isScanning ? m.games_scan_scanning() : m.games_scan_all()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={isScanning}
                render={
                  <Button size="sm" className="-ml-px rounded-l-none px-1.5" disabled={isScanning}>
                    <RiArrowDownSLine className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleScan(scanSteamGames)}>
                  <RiSteamLine className="size-4" />
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
          <AddGameDialog>
            <Button variant="primary" size="sm">
              <RiAddLine data-icon="inline-start" />
              {m.games_add_game()}
            </Button>
          </AddGameDialog>
        </div>
      </div>

      <TextField
        className="mt-4 max-w-xs"
        prefix={<RiSearchLine />}
        aria-label={m.games_search_placeholder()}
        placeholder={m.games_search_placeholder()}
        value={search}
        onChange={e => handleSearchChange(e.target.value)}
      />

      {isError ? (
        <div className="text-destructive mt-6 text-sm">{m.games_loading_error()}</div>
      ) : (
        <DataTable
          className="mt-4"
          columns={columns}
          rows={games}
          loading={isLoading}
          pagination={{
            pageIndex: page,
            pageSize: PAGE_SIZE,
            rowCount: totalCount,
            onPageChange: setPage,
          }}
          empty={
            isSearching ? (
              <EmptyState title={m.search_no_match({ query })} />
            ) : (
              <EmptyState title={m.games_empty_title()}>{m.games_empty_description()}</EmptyState>
            )
          }
        />
      )}
    </div>
  )
}
