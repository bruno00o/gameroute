type ErrorReportInput = {
  error: unknown
  componentStack?: string | null
  path?: string
  version?: string | null
  locale?: string
  userAgent?: string
  now?: Date
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

export function buildErrorReport({
  error,
  componentStack,
  path,
  version,
  locale,
  userAgent,
  now = new Date(),
}: ErrorReportInput): string {
  const lines = [`GameRoute ${version ?? 'unknown version'}`, `Time: ${now.toISOString()}`]
  if (path) lines.push(`Screen: ${path}`)
  if (locale) lines.push(`Language: ${locale}`)
  if (userAgent) lines.push(`User agent: ${userAgent}`)
  lines.push('', describeError(error))

  const stack = error instanceof Error ? error.stack?.trim() : undefined
  if (stack) lines.push('', stack)
  if (componentStack?.trim()) lines.push('', 'Component stack:', componentStack.trim())

  return lines.join('\n')
}
