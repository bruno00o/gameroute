import { useCallback, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiGamepadLine,
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
import { formatDate, formatDuration } from '@/lib/format'
import { errorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

export const Route = createFileRoute('/games')({
  component: GamesPage,
})

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<GameListItem>()

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

  const isSearching = debouncedSearch.trim().length > 0

  const { data, isLoading, isError } = useQuery({
    queryKey: ['games', page, debouncedSearch],
    queryFn: async () => {
      const query = debouncedSearch.trim()
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
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

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
      (old) => {
        if (!old) return old
        return {
          ...old,
          items: old.items.map((game) =>
            game.id === id ? { ...game, monitored } : game,
          ),
        }
      },
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

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: () => m.games_col_name(),
        cell: info => {
          const game = info.row.original
          return (
            <div>
              <span className="font-medium">{info.getValue()}</span>
              {game.executableName && (
                <span className="text-muted-foreground block text-xs">{game.executableName}</span>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor('source', {
        header: () => m.games_col_source(),
        cell: info => {
          const source = info.getValue()
          const label =
            source === 'steam'
              ? 'Steam'
              : source === 'epic'
                ? 'Epic'
                : source === 'manual'
                  ? 'Manual'
                  : source
          if (source === 'manual') {
            return (
              <Tooltip>
                <TooltipTrigger className="cursor-default">
                  <Badge variant="secondary">{label}</Badge>
                </TooltipTrigger>
                <TooltipContent>{m.games_source_manual_tooltip()}</TooltipContent>
              </Tooltip>
            )
          }
          return <Badge variant="secondary">{label}</Badge>
        },
      }),
      columnHelper.accessor('sessionCount', {
        header: () => m.games_col_sessions(),
        cell: info => {
          const val = info.getValue()
          return val > 0 ? val : <span className="text-muted-foreground">-</span>
        },
      }),
      columnHelper.accessor('totalPlayTimeSecs', {
        header: () => m.games_col_play_time(),
        cell: info => {
          const val = info.getValue()
          return val > 0 ? (
            formatDuration(val)
          ) : (
            <span className="text-muted-foreground">-</span>
          )
        },
      }),
      columnHelper.accessor('monitored', {
        header: () => m.games_col_monitored(),
        cell: info => {
          const game = info.row.original
          return (
            <Switch
              size="sm"
              checked={info.getValue()}
              onCheckedChange={checked => handleToggleMonitored(game.id, checked)}
              onClick={e => e.stopPropagation()}
            />
          )
        },
      }),
      columnHelper.accessor('lastPlayedAt', {
        header: () => m.games_col_last_played(),
        cell: info => {
          const val = info.getValue()
          return val ? formatDate(val) : <span className="text-muted-foreground">-</span>
        },
      }),
      columnHelper.display({
        id: 'actions',
        cell: info => {
          const game = info.row.original
          return (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={e => e.stopPropagation()}
                    aria-label={m.games_delete_game()}
                  >
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
                  <AlertDialogAction variant="destructive" onClick={() => handleDeleteGame(game.id)}>
                    {m.games_delete_confirm()}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        },
      }),
    ],
    []
  )

  const table = useReactTable({
    data: games,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

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
              variant="outline"
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="-ml-px rounded-l-none px-1.5"
                    disabled={isScanning}
                  >
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
            <Button size="sm">
              <RiAddLine className="size-4" data-icon="inline-start" />
              {m.games_add_game()}
            </Button>
          </AddGameDialog>
        </div>
      </div>

      <div className="relative mt-4 max-w-xs">
        <RiSearchLine className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          className="pl-8"
          placeholder={m.games_search_placeholder()}
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
        />
      </div>

      {isError && <div className="text-destructive mt-6 text-sm">{m.sessions_loading_error()}</div>}

      {isLoading ? (
        <GamesTableSkeleton />
      ) : games.length === 0 ? (
        <EmptyState isSearching={isSearching} />
      ) : (
        <>
          <div className="mt-4">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map(headerGroup => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map(row => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalCount > PAGE_SIZE && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              onPrev={() => setPage(p => Math.max(0, p - 1))}
              onNext={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            />
          )}
        </>
      )}
    </div>
  )
}

function EmptyState({ isSearching }: { isSearching: boolean }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <RiGamepadLine className="text-muted-foreground size-10" />
      <h2 className="text-lg font-medium">
        {isSearching ? m.command_empty() : m.games_empty_title()}
      </h2>
      <p className="text-muted-foreground text-sm">
        {isSearching ? '' : m.games_empty_description()}
      </p>
    </div>
  )
}

function GamesTableSkeleton() {
  return (
    <div className="mt-4">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: 7 }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-14" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-10" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-14" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-6" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
}: {
  page: number
  totalPages: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
}) {
  const start = page * PAGE_SIZE + 1
  const end = Math.min((page + 1) * PAGE_SIZE, totalCount)

  return (
    <div className="mt-4 flex items-center justify-between">
      <span className="text-muted-foreground text-xs">
        {m.games_page_info({
          start: String(start),
          end: String(end),
          total: String(totalCount),
        })}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={onPrev}>
          <RiArrowLeftSLine className="size-4" data-icon="inline-start" />
          {m.sessions_prev()}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={onNext}>
          {m.sessions_next()}
          <RiArrowRightSLine className="size-4" data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
