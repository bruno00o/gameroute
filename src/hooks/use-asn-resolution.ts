import { useCallback, useEffect, useRef, useState } from 'react'

import type { ResolvedIpData } from '@/types/backend'
import { resolveAsn } from '@/lib/tauri'

export function useAsnResolution(ips: string[]) {
  const [data, setData] = useState<Map<string, ResolvedIpData>>(new Map())
  const [loading, setLoading] = useState(false)
  const resolvedRef = useRef<Set<string>>(new Set())

  const resolve = useCallback(async (unresolvedIps: string[]) => {
    setLoading(true)
    try {
      const results = await resolveAsn(unresolvedIps)
      for (const ip of unresolvedIps) {
        resolvedRef.current.add(ip)
      }
      setData(prev => {
        const next = new Map(prev)
        for (const entry of results) {
          next.set(entry.ip, entry)
        }
        return next
      })
    } catch {
      // ASN resolution is best-effort, don't break the UI
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const unresolvedIps = ips.filter(ip => !resolvedRef.current.has(ip))
    if (unresolvedIps.length === 0) return

    let cancelled = false

    resolve(unresolvedIps).then(() => {
      if (cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [ips, resolve])

  return { data, loading }
}
