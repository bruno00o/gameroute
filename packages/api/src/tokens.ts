const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const REPORT_ID_LENGTH = 22

export const REPORT_ID_PATTERN = /^[0-9A-Za-z]{16,64}$/

export function createReportId(): string {
  let id = ''
  while (id.length < REPORT_ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(REPORT_ID_LENGTH * 2))) {
      if (byte < 248 && id.length < REPORT_ID_LENGTH) id += BASE62[byte % 62]
    }
  }
  return id
}

export function createDeleteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
