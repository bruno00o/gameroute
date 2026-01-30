import { create } from 'zustand'

export type BreadcrumbSegment = {
  label: string
  onClick?: () => void
}

type BreadcrumbStore = {
  segments: BreadcrumbSegment[]
  setSegments: (segments: BreadcrumbSegment[]) => void
}

export const useBreadcrumbStore = create<BreadcrumbStore>(set => ({
  segments: [],
  setSegments: segments => set({ segments }),
}))
