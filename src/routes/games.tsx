import { createFileRoute } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/games')({
  component: GamesPage,
})

function GamesPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_games_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_games_description()}</p>
    </div>
  )
}
