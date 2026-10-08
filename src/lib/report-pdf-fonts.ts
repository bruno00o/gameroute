import archivoRegular from '@fontsource/archivo/files/archivo-latin-400-normal.woff?inline'
import archivoSemibold from '@fontsource/archivo/files/archivo-latin-600-normal.woff?inline'
import archivoBold from '@fontsource/archivo/files/archivo-latin-700-normal.woff?inline'
import monoRegular from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?inline'
import monoMedium from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff?inline'
import symbols from '@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff?inline'

import type { ReportPdfFonts } from '@/lib/report-pdf'

function decode(dataUri: string): Uint8Array {
  const binary = atob(dataUri.slice(dataUri.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function reportPdfFonts(): ReportPdfFonts {
  return {
    ui: decode(archivoRegular),
    uiSemibold: decode(archivoSemibold),
    uiBold: decode(archivoBold),
    mono: decode(monoRegular),
    monoMedium: decode(monoMedium),
    symbols: decode(symbols),
  }
}
