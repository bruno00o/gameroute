import * as m from '@/paraglide/messages'

const errorCodeMap: Record<string, () => string> = {
  ALREADY_MONITORING: () => m.error_already_monitoring(),
  NOT_MONITORING: () => m.error_not_monitoring(),
  REPO_NOT_INITIALIZED: () => m.error_repo_not_initialized(),
  PROCESS_NOT_FOUND: () => m.error_process_not_found(),
}

/** Extract a user-friendly message from a backend CommandError or unknown error. */
export function friendlyError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code)
    const mapped = errorCodeMap[code]
    if (mapped) return mapped()
  }
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err)
    return String((err as { message: string }).message)
  return m.error_monitoring_generic()
}
