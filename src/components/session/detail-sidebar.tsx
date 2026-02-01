import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import {
  RiArrowLeftLine,
  RiDashboardLine,
  RiDeleteBinLine,
  RiGlobalLine,
  RiSortAsc,
  RiSortDesc,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { IpPeriod, SessionDetail } from '@/types/backend'
import { formatDuration, computeDurationSecs } from '@/lib/format'
import { cn } from '@/lib/utils'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export type SortMode = 'time' | 'duration' | 'packets'

export function DetailSidebar({
  detail,
  selectedPeriodId,
  sortMode,
  sortAsc,
  onSortChange,
  onSortDirectionChange,
  onSelectOverview,
  onSelectPeriod,
  onDelete,
}: {
  detail: SessionDetail
  selectedPeriodId: number | undefined
  sortMode: SortMode
  sortAsc: boolean
  onSortChange: (mode: SortMode) => void
  onSortDirectionChange: () => void
  onSelectOverview: () => void
  onSelectPeriod: (id: number) => void
  onDelete: () => void
}) {
  const isActive = detail.endedAt === null

  const sortedPeriods = useMemo(() => {
    const dir = sortAsc ? 1 : -1
    const periods = [...detail.ipPeriods]
    switch (sortMode) {
      case 'time':
        return periods.sort(
          (a, b) => dir * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
        )
      case 'duration': {
        const dur = (p: IpPeriod) => new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime()
        return periods.sort((a, b) => dir * (dur(a) - dur(b)))
      }
      case 'packets':
        return periods.sort((a, b) => dir * (a.packetCount - b.packetCount))
    }
  }, [detail.ipPeriods, sortMode, sortAsc])

  return (
    <Sidebar collapsible="none" className="bg-background border-r">
      <SidebarHeader>
        <Button
          className="self-start pl-0"
          variant="ghost"
          size="xs"
          render={<Link to="/sessions" />}
        >
          <RiArrowLeftLine className="size-3.5" />
          {m.page_sessions_title()}
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">{detail.gameName}</h2>
          <Badge variant={isActive ? 'default' : 'secondary'}>
            {isActive ? m.sessions_status_active() : m.sessions_status_completed()}
          </Badge>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={selectedPeriodId == null} onClick={onSelectOverview}>
                <RiDashboardLine />
                <span>{m.session_overview()}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroupLabel className="mt-2">{m.session_timeline()}</SidebarGroupLabel>
          <SortToggle
            value={sortMode}
            asc={sortAsc}
            onChange={onSortChange}
            onDirectionChange={onSortDirectionChange}
          />
          <SidebarMenu className="mt-2 gap-0.5">
            {sortedPeriods.map(period => {
              const durationSecs = computeDurationSecs(period.startedAt, period.endedAt)
              return (
                <SidebarMenuItem key={period.id}>
                  <SidebarMenuButton
                    isActive={selectedPeriodId === period.id}
                    onClick={() => onSelectPeriod(period.id)}
                  >
                    <RiGlobalLine className="shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-mono text-xs">{period.ip}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {formatDuration(durationSecs)} &middot; {period.packetCount} pkt
                      </span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
            {sortedPeriods.length === 0 && <p className="text-muted-foreground px-2 text-xs">-</p>}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" size="sm" className="w-full">
                <RiDeleteBinLine className="size-3.5" data-icon="inline-start" />
                {m.session_delete()}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{m.session_delete_title()}</AlertDialogTitle>
              <AlertDialogDescription>{m.session_delete_description()}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{m.session_delete_cancel()}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                {m.session_delete_confirm()}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarFooter>
    </Sidebar>
  )
}

function SortToggle({
  value,
  asc,
  onChange,
  onDirectionChange,
}: {
  value: SortMode
  asc: boolean
  onChange: (mode: SortMode) => void
  onDirectionChange: () => void
}) {
  const modes: { key: SortMode; label: () => string }[] = [
    { key: 'time', label: m.session_sort_time },
    { key: 'duration', label: m.session_sort_duration },
    { key: 'packets', label: m.session_sort_packets },
  ]

  const SortIcon = asc ? RiSortAsc : RiSortDesc

  return (
    <div className="flex items-center gap-0.5 px-2 pb-0.5">
      <button
        onClick={onDirectionChange}
        className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer transition-colors"
      >
        <SortIcon className="size-3.5" />
      </button>
      {modes.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-none px-2 py-1 text-xs cursor-pointer transition-colors',
            value === key
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label()}
        </button>
      ))}
    </div>
  )
}
