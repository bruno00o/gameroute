import { createFileRoute } from '@tanstack/react-router'
import { handleApi } from '@/lib/api'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: ({ request }) => handleApi(request),
    },
  },
})
