import { getLocale } from '@/paraglide/runtime'

export function formatNumber(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatPercent(value: number) {
  return `${formatNumber(value, 1)} %`
}

export function countryName(code: string) {
  return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) ?? code
}
