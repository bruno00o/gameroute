import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  RiShieldKeyholeLine,
  RiEyeOffLine,
  RiLockLine,
  RiSpeedLine,
} from '@remixicon/react'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { useSettingsStore } from '@/stores/settings-store'
import { LogoMark } from '@/components/logo-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SwitchField } from '@/components/ui/switch'

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
})

function WelcomePage() {
  const setOnboardingCompleted = useSettingsStore(s => s.setOnboardingCompleted)
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const setAdvancedMode = useSettingsStore(s => s.setAdvancedMode)
  const navigate = useNavigate()

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

  const handleLaunch = () => {
    setOnboardingCompleted(true)
    navigate({ to: '/' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <LogoMark role="img" aria-label="GameRoute" className="mx-auto block size-16" />
          <h1 className="text-3xl font-bold">{m.welcome_title()}</h1>
          <p className="text-muted-foreground">{m.welcome_subtitle()}</p>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiShieldKeyholeLine className="size-5 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm">{m.welcome_admin_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_admin_body()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiLockLine className="size-5 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm">{m.welcome_privacy_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_privacy_body()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiEyeOffLine className="size-5 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm">{m.welcome_no_collection_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_no_collection_body()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiSpeedLine className="size-5 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm">{m.welcome_performance_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_performance_body()}</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <SwitchField
            className="rounded-sm border bg-card px-4 py-3"
            label={m.welcome_launch_on_startup()}
            description={m.welcome_launch_on_startup_description()}
            checked={launchOnStartup}
            onCheckedChange={handleLaunchOnStartup}
            disabled={launchOnStartupLoading}
          />
          <SwitchField
            className="rounded-sm border bg-card px-4 py-3"
            label={m.welcome_advanced_mode()}
            description={m.welcome_advanced_mode_description()}
            checked={advancedMode}
            onCheckedChange={setAdvancedMode}
          />
        </div>

        <div className="text-center space-y-3">
          <Button variant="primary" size="lg" onClick={handleLaunch}>
            {m.welcome_launch_button()}
          </Button>
          <p className="text-muted-foreground text-xs">
            {m.welcome_help_prefix()}{' '}
            <Link to="/help" className="text-primary underline underline-offset-2">
              {m.welcome_help_link_text()}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
