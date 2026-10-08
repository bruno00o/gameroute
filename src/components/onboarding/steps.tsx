import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getLocale, locales, setLocale } from '@/paraglide/runtime'
import type { GameListItem } from '@/types/backend'
import { getGames, restartCaptureService, scanAllGames, toggleGameMonitored } from '@/lib/tauri'
import { EXAMPLE_ROUTE } from '@/lib/example-route'
import { launcherName } from '@/lib/games'
import { errorMessage } from '@/lib/utils'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { useSettingsStore } from '@/stores/settings-store'
import { AddGameDialog } from '@/components/add-game-dialog'
import { Fact, FactRow } from '@/components/fact-row'
import { Notice } from '@/components/notice'
import { TOTAL_STEPS } from '@/components/onboarding/total-steps'
import { OnboardingStep } from '@/components/onboarding-step'
import { RouteStrip } from '@/components/route/route-strip'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { SwitchField } from '@/components/ui/switch'

const GAMES_LIMIT = 1000
const GAMES_KEY = ['games', 'onboarding']

const localeLabels: Record<(typeof locales)[number], () => string> = {
  en: m.settings_language_en,
  fr: m.settings_language_fr,
  es: m.settings_language_es,
}

type StepProps = {
  onBack?: () => void
  onNext: () => void
}

function BackButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return undefined
  return (
    <Button variant="ghost" onClick={onClick}>
      {m.onboarding_back()}
    </Button>
  )
}

function ContinueButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" size="lg" onClick={onClick}>
      {m.onboarding_continue()}
    </Button>
  )
}

function WelcomeStep({ onNext }: StepProps) {
  const bumpLocaleVersion = useSettingsStore(s => s.bumpLocaleVersion)

  const handleLocaleChange = (locale: (typeof locales)[number]) => {
    setLocale(locale, { reload: false })
    bumpLocaleVersion()
  }

  return (
    <OnboardingStep
      step={1}
      total={TOTAL_STEPS}
      title={m.onboarding_welcome_title()}
      extra={
        <div className="flex flex-col gap-2">
          <p className="text-label text-muted-foreground font-stretch-[92%]">
            {m.help_how_example()}
          </p>
          <RouteStrip
            route={EXAMPLE_ROUTE}
            destination={{ name: EXAMPLE_ROUTE.destinationName ?? '' }}
            orientation="vertical"
          />
        </div>
      }
      secondary={
        <Segmented
          label={m.settings_language()}
          value={getLocale()}
          onValueChange={handleLocaleChange}
          options={locales.map(locale => ({ value: locale, label: localeLabels[locale]() }))}
        />
      }
      primary={<ContinueButton onClick={onNext} />}
    >
      {m.onboarding_welcome_body()}
    </OnboardingStep>
  )
}

function CaptureStep({ onBack, onNext }: StepProps) {
  const { isServiceRunning, isLoading } = useServiceHealthCheck()
  const queryClient = useQueryClient()
  const [isRestarting, setIsRestarting] = useState(false)

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      await restartCaptureService()
      toast.success(m.service_warning_fix_success())
      await queryClient.invalidateQueries({ queryKey: ['capture-service-status'] })
    } catch {
      toast.error(m.service_warning_fix_error())
    } finally {
      setIsRestarting(false)
    }
  }

  const down = !isLoading && !isServiceRunning

  return (
    <OnboardingStep
      step={2}
      total={TOTAL_STEPS}
      title={m.onboarding_capture_title()}
      items={[
        m.settings_capture_feature_servers(),
        m.settings_capture_feature_voice(),
        m.settings_capture_feature_probes(),
      ]}
      extra={
        down ? (
          <Notice
            tone="watch"
            title={m.service_warning_title()}
            action={
              <Button size="sm" loading={isRestarting} onClick={handleRestart}>
                {m.service_warning_fix()}
              </Button>
            }
          >
            {m.onboarding_capture_down({
              settings: m.nav_settings(),
              section: m.settings_section_capture(),
            })}
          </Notice>
        ) : (
          <FactRow>
            <Fact label={m.settings_capture_status()}>
              {isLoading ? m.settings_capture_checking() : m.onboarding_capture_active()}
            </Fact>
          </FactRow>
        )
      }
      secondary={<BackButton onClick={onBack} />}
      primary={<ContinueButton onClick={onNext} />}
    >
      {m.onboarding_capture_body()}
    </OnboardingStep>
  )
}

function gamesTitle(games: GameListItem[] | undefined): string {
  if (!games) return m.onboarding_games_title_loading()
  if (games.length === 0) return m.onboarding_games_title_none()
  if (games.length === 1) return m.onboarding_games_title_one()
  return m.onboarding_games_title_other({ count: String(games.length) })
}

function GamesStep({ onBack, onNext }: StepProps) {
  const queryClient = useQueryClient()
  const [isScanning, setIsScanning] = useState(false)

  const {
    data: games,
    isError,
    refetch,
  } = useQuery({
    queryKey: GAMES_KEY,
    queryFn: () => getGames(GAMES_LIMIT, 0),
    refetchInterval: query => (query.state.data?.length ? false : 3000),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['games'] })
    queryClient.invalidateQueries({ queryKey: ['games-totals'] })
  }

  const handleToggle = async (id: number, monitored: boolean) => {
    queryClient.setQueryData<GameListItem[]>(GAMES_KEY, old =>
      old?.map(game => (game.id === id ? { ...game, monitored } : game))
    )
    try {
      await toggleGameMonitored(id, monitored)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      refresh()
    }
  }

  const handleScan = async () => {
    setIsScanning(true)
    try {
      const result = await scanAllGames()
      toast.success(
        m.games_scan_success({
          found: String(result.gamesFound),
          added: String(result.gamesAdded),
          updated: String(result.gamesUpdated),
        })
      )
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <OnboardingStep
      step={3}
      total={TOTAL_STEPS}
      title={gamesTitle(games)}
      extra={
        <>
          {isError ? (
            <Notice
              tone="critical"
              title={m.games_loading_error()}
              action={
                <Button size="sm" onClick={() => refetch()}>
                  {m.games_error_retry()}
                </Button>
              }
            />
          ) : games && games.length === 0 ? (
            <p className="text-ui text-muted-foreground">{m.onboarding_games_empty()}</p>
          ) : (
            games && (
              <ul className="max-h-[288px] overflow-y-auto rounded-sm border">
                {games.map(game => (
                  <li key={game.id} className="border-b px-3.5 py-3 last:border-b-0">
                    <SwitchField
                      label={game.name}
                      description={launcherName(game.source) ?? m.games_source_manual()}
                      checked={game.monitored}
                      onCheckedChange={checked => handleToggle(game.id, checked)}
                    />
                  </li>
                ))}
              </ul>
            )
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" loading={isScanning} onClick={handleScan}>
              {isScanning ? m.games_scan_scanning() : m.onboarding_games_rescan()}
            </Button>
            <AddGameDialog>
              <Button variant="ghost" size="sm">
                {m.games_add_game()}
              </Button>
            </AddGameDialog>
          </div>
        </>
      }
      secondary={<BackButton onClick={onBack} />}
      primary={<ContinueButton onClick={onNext} />}
    >
      {m.onboarding_games_body()}
    </OnboardingStep>
  )
}

function DataStep({ onBack, onNext }: StepProps) {
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const setAdvancedMode = useSettingsStore(s => s.setAdvancedMode)
  const [launchOnStartup, setLaunchOnStartup] = useState(false)
  const [launchOnStartupLoading, setLaunchOnStartupLoading] = useState(true)

  useEffect(() => {
    isEnabled()
      .then(setLaunchOnStartup)
      .catch(() => {})
      .finally(() => setLaunchOnStartupLoading(false))
  }, [])

  const handleLaunchOnStartup = async (value: boolean) => {
    try {
      if (value) await enable()
      else await disable()
      setLaunchOnStartup(value)
    } catch {
      toast.error(m.settings_launch_on_startup_error())
    }
  }

  return (
    <OnboardingStep
      step={4}
      total={TOTAL_STEPS}
      title={m.onboarding_data_title()}
      items={[
        m.onboarding_data_operators(),
        m.onboarding_data_game_logs(),
        m.settings_local_connections(),
      ]}
      extra={
        <>
          <SwitchField
            label={m.settings_launch_on_startup()}
            description={m.settings_launch_on_startup_description()}
            checked={launchOnStartup}
            onCheckedChange={handleLaunchOnStartup}
            disabled={launchOnStartupLoading}
          />
          <SwitchField
            label={m.settings_detailed_view()}
            description={m.settings_detailed_view_description()}
            checked={advancedMode}
            onCheckedChange={setAdvancedMode}
          />
        </>
      }
      secondary={<BackButton onClick={onBack} />}
      primary={
        <Button variant="primary" size="lg" onClick={onNext}>
          {m.onboarding_finish()}
        </Button>
      }
    >
      {m.onboarding_data_body()}
    </OnboardingStep>
  )
}

export { CaptureStep, DataStep, GamesStep, WelcomeStep }
