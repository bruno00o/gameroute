import { Skeleton } from '@/components/ui/skeleton'

export function DetailSkeleton() {
  return (
    <div aria-busy="true" className="h-full overflow-y-auto">
      <div className="flex min-h-14 items-center gap-3 border-b px-4 py-2.5 sm:px-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
