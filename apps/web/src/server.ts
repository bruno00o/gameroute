import { createDb, purgeExpiredReports } from '@gameroute/db'
import handler from '@tanstack/react-start/server-entry'
import { paraglideMiddleware } from './paraglide/server.js'

export default {
  fetch(request: Request) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handler.fetch(request)
    return paraglideMiddleware(request, () => handler.fetch(request))
  },

  async scheduled(_controller: ScheduledController, env: Env) {
    const db = createDb(env.HYPERDRIVE.connectionString)
    try {
      const purged = await purgeExpiredReports(db)
      console.log(`Purged ${purged} expired reports`)
    } finally {
      await db.$client.end()
    }
  },
}
