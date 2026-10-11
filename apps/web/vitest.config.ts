import path from 'node:path'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { paraglideOptions } from './paraglide.config.ts'

export default defineConfig({
  plugins: [paraglideVitePlugin(paraglideOptions), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
