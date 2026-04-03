"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function ArtifactSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* KPI cards row */}
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      {/* Main chart area */}
      <Skeleton className="h-64 flex-1 rounded-xl" />

      {/* Table rows */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-8 rounded-lg"
            style={{ opacity: 1 - i * 0.25 }}
          />
        ))}
      </div>
    </div>
  )
}
