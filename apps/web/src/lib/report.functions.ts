import { createServerFn } from '@tanstack/react-start'
import { loadReport } from './report.server'

export const getReport = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(({ data }) => loadReport(data))
