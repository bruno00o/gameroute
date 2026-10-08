import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'display',
        'title',
        'heading',
        'body',
        'ui',
        'label',
        'overline',
        'readout-xl',
        'readout',
        'data',
        'data-sm',
      ],
      ease: ['standard', 'exit'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String(err.message)
  return JSON.stringify(err)
}
