import { Skeleton } from '@/components/ui/skeleton'

export function DetailSkeleton() {
  return (
    <div className="flex h-full">
      <div className="bg-background w-64 border-r p-4">
        <Skeleton className="mb-4 h-6 w-20" />
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="mb-6 h-5 w-16" />
        <Skeleton className="mb-2 h-8 w-full" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-4">
        <Skeleton className="mb-4 h-6 w-48" />
        <Skeleton className="mb-6 h-px w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
