import { Card } from "./ui/card";

interface SkeletonProps {
  className?: string;
}

function SkeletonLine({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-border ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <Card className="p-4">
      <SkeletonLine className="h-3 w-20 mb-3" />
      <SkeletonLine className="h-8 w-32" />
    </Card>
  );
}

export function SkeletonTable({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
