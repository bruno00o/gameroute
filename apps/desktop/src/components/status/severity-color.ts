import type { Severity } from '@/types/backend'

export const severityText: Record<Severity, string> = {
  ok: 'text-ok',
  watch: 'text-watch',
  degraded: 'text-degraded',
  critical: 'text-critical',
  unmeasured: 'text-unmeasured',
}
