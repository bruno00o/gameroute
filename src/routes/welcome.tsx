import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useSettingsStore } from '@/stores/settings-store'
import { LogoMark } from '@/components/logo-mark'
import { CaptureStep, DataStep, GamesStep, WelcomeStep } from '@/components/onboarding/steps'

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
})

function WelcomePage() {
  const setOnboardingCompleted = useSettingsStore(s => s.setOnboardingCompleted)
  const localeVersion = useSettingsStore(s => s._localeVersion)
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  const next = () => setStep(current => current + 1)
  const back = () => setStep(current => current - 1)

  const finish = () => {
    setOnboardingCompleted(true)
    navigate({ to: '/' })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-2.5 px-7 py-5">
        <LogoMark role="img" aria-label="GameRoute" className="size-7" />
        <span className="text-heading font-bold tracking-[-0.01em] font-stretch-[112%]">
          GameRoute
        </span>
      </header>
      <main key={localeVersion} className="flex flex-1 justify-center px-6 pt-2 pb-12">
        {step === 1 && <WelcomeStep onNext={next} />}
        {step === 2 && <CaptureStep onBack={back} onNext={next} />}
        {step === 3 && <GamesStep onBack={back} onNext={next} />}
        {step === 4 && <DataStep onBack={back} onNext={finish} />}
      </main>
    </div>
  )
}
