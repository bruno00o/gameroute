import { createFileRoute } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/help')({
  component: HelpPage,
})

function HelpPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_help_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_help_description()}</p>
    </div>
  )
}
