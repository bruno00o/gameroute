import { useEffect, useState } from 'react'

import { ThemeProviderContext } from '@/components/use-theme'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: 'dark' | 'light' | 'system'
  storageKey?: string
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(
    () => (localStorage.getItem(storageKey) as 'dark' | 'light' | 'system') || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      const applySystemTheme = () => {
        root.classList.toggle('dark', query.matches)
        root.classList.toggle('light', !query.matches)
      }

      applySystemTheme()
      query.addEventListener('change', applySystemTheme)
      return () => query.removeEventListener('change', applySystemTheme)
    }

    root.classList.add(theme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: 'dark' | 'light' | 'system') => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
