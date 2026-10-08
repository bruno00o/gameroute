import { useMemo, useState as useLocalState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  RiArrowLeftLine,
  RiDashboardLine,
  RiDeleteBinLine,
  RiGamepadLine,
  RiGlobalLine,
  RiInformationLine,
  RiMicLine,
  RiSortAsc,
  RiSortDesc,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionDetail } from '@/types/backend'
import { formatDuration, computeDurationSecs } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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

  const [gsSortMode, setGsSortMode] = useLocalState<SortMode>('duration')
  const [gsSortAsc, setGsSortAsc] = useLocalState(false)

  const gameServerPeriods = useMemo(() => {
    const periods = detail.ipPeriods.filter(p => p.isGameServer)
    const dir = gsSortAsc ? 1 : -1
    switch (gsSortMode) {
      case 'time':
        return [...periods].sort(
          (a, b) => dir * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
        )
      case 'duration': {
        const dur = (p: typeof periods[0]) =>
          new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime()
        return [...periods].sort((a, b) => dir * (dur(a) - dur(b)))
      }
      case 'packets':
        return [...periods].sort((a, b) => dir * (a.packetCount - b.packetCount))
    }
  }, [detail.ipPeriods, gsSortMode, gsSortAsc])

  const voicePeriods = useMemo(
    () =>
      detail.ipPeriods
        .filter(p => p.flowKind === 'voice')
        .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    [detail.ipPeriods],
  )

  const sortedPeriods = useMemo(() => {
    const dir = sortAsc ? 1 : -1
    const periods = [...detail.ipPeriods]
    switch (sortMode) {
      case 'time':
        return periods.sort(
          (a, b) => dir * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
        )
      case 'duration': {
        const dur = (p: typeof periods[0]) =>
          new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime()
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
          size="sm"
          nativeButton={false}
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

          {gameServerPeriods.length > 0 && (
            <>
              <SidebarGroupLabel className="mt-2 gap-1.5">
                <RiGamepadLine className="size-3.5 text-muted-foreground" />
                {m.session_game_servers()}
                <Tooltip>
                  <TooltipTrigger
                    render={<RiInformationLine className="text-muted-foreground ml-auto size-3.5 shrink-0 cursor-help" />}
                  />
                  <TooltipContent side="right" className="max-w-52">
                    {m.session_game_servers_hint()}
                  </TooltipContent>
                </Tooltip>
              </SidebarGroupLabel>
              <SortToggle
                value={gsSortMode}
                asc={gsSortAsc}
                onChange={setGsSortMode}
                onDirectionChange={() => setGsSortAsc(v => !v)}
              />
              <SidebarMenu className="mt-1 gap-0.5">
                {gameServerPeriods.map(period => (
                  <PeriodItem
                    key={`gs-${period.id}`}
                    period={period}
                    isActive={selectedPeriodId === period.id}
                    onSelect={onSelectPeriod}
                    highlight
                  />
                ))}
              </SidebarMenu>
            </>
          )}

          {voicePeriods.length > 0 && (
            <>
              <SidebarGroupLabel className="mt-2 gap-1.5">
                <RiMicLine className="size-3.5 text-muted-foreground" />
                {m.session_voice()}
                <Tooltip>
                  <TooltipTrigger
                    render={<RiInformationLine className="text-muted-foreground ml-auto size-3.5 shrink-0 cursor-help" />}
                  />
                  <TooltipContent side="right" className="max-w-52">
                    {m.session_voice_hint()}
                  </TooltipContent>
                </Tooltip>
              </SidebarGroupLabel>
              <SidebarMenu className="mt-1 gap-0.5">
                {voicePeriods.map(period => (
                  <PeriodItem
                    key={`voice-${period.id}`}
                    period={period}
                    isActive={selectedPeriodId === period.id}
                    onSelect={onSelectPeriod}
                    highlight={false}
                  />
                ))}
              </SidebarMenu>
            </>
          )}

          <SidebarGroupLabel className="mt-2">{m.session_timeline()}</SidebarGroupLabel>
          <SortToggle
            value={sortMode}
            asc={sortAsc}
            onChange={onSortChange}
            onDirectionChange={onSortDirectionChange}
          />
          <SidebarMenu className="mt-2 gap-0.5">
            {sortedPeriods.map(period => (
              <PeriodItem
                key={period.id}
                period={period}
                isActive={selectedPeriodId === period.id}
                onSelect={onSelectPeriod}
                highlight={period.isGameServer}
              />
            ))}
            {sortedPeriods.length === 0 && <p className="text-muted-foreground px-2 text-xs">-</p>}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="danger" size="sm" className="w-full">
                <RiDeleteBinLine data-icon="inline-start" />
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
              <AlertDialogAction variant="danger" onClick={onDelete}>
                {m.session_delete_confirm()}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarFooter>
    </Sidebar>
  )
}

function PeriodItem({
  period,
  isActive,
  onSelect,
  highlight,
}: {
  period: SessionDetail['ipPeriods'][number]
  isActive: boolean
  onSelect: (id: number) => void
  highlight: boolean
}) {
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const durationSecs = computeDurationSecs(period.startedAt, period.endedAt)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => onSelect(period.id)}
      >
        {highlight ? (
          <Tooltip>
            <TooltipTrigger
              render={<RiGamepadLine className="shrink-0 text-muted-foreground" />}
            />
            <TooltipContent side="right">{m.session_likely_game_server()}</TooltipContent>
          </Tooltip>
        ) : period.flowKind === 'voice' ? (
          <Tooltip>
            <TooltipTrigger render={<RiMicLine className="shrink-0 text-muted-foreground" />} />
            <TooltipContent side="right">{m.session_likely_voice()}</TooltipContent>
          </Tooltip>
        ) : (
          <RiGlobalLine className="shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs">{period.ip}</span>
            {advancedMode && period.protocol && period.port > 0 && (
              <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px] font-normal">
                {period.protocol}:{period.port}
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground text-[10px]">
            {advancedMode
              ? <>{formatDuration(durationSecs)} &middot; {m.session_packets_short({ count: period.packetCount.toString() })}</>
              : formatDuration(durationSecs)}
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
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
