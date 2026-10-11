import type { Database } from '@gameroute/db'

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface RateLimits {
  create?: RateLimiter
  delete?: RateLimiter
}

export interface ResponseCache {
  match(key: string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface ApiServices {
  db?: Database
  limits?: RateLimits
  cache?: ResponseCache
}

export type ApiBindings = ApiServices

export interface ApiEnv {
  Bindings: ApiBindings | undefined
  Variables: { services: ApiServices }
}
