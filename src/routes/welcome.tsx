import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  RiShieldKeyholeLine,
  RiEyeOffLine,
  RiLockLine,
  RiRouterLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { useSettingsStore } from '@/stores/settings-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
})

function WelcomePage() {
  const setOnboardingCompleted = useSettingsStore(s => s.setOnboardingCompleted)
  const navigate = useNavigate()

  const handleLaunch = () => {
    setOnboardingCompleted(true)
    navigate({ to: '/' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <RiRouterLine className="mx-auto size-14 text-primary" />
          <h1 className="text-3xl font-bold">{m.welcome_title()}</h1>
          <p className="text-muted-foreground">{m.welcome_subtitle()}</p>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiShieldKeyholeLine className="size-5 text-blue-500 shrink-0" />
              <CardTitle className="text-sm">{m.welcome_admin_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_admin_body()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiLockLine className="size-5 text-green-500 shrink-0" />
              <CardTitle className="text-sm">{m.welcome_privacy_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_privacy_body()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <RiEyeOffLine className="size-5 text-amber-500 shrink-0" />
              <CardTitle className="text-sm">{m.welcome_no_collection_title()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{m.welcome_no_collection_body()}</p>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button size="lg" onClick={handleLaunch}>
            {m.welcome_launch_button()}
          </Button>
        </div>
      </div>
    </div>
  )
}
