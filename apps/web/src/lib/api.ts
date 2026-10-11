import { createApp } from '@gameroute/api'

const app = createApp()

export function handleApi(request: Request) {
  return app.fetch(request)
}
