import { cloudflare } from '@cloudflare/vite-plugin'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { paraglideOptions } from './paraglide.config.ts'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    paraglideVitePlugin(paraglideOptions),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    react(),
  ],
})
