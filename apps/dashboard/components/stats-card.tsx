import { Card } from "./ui/card";

interface StatsCardProps {
  label: string;
  value: string;
  valueColor?: string;
}

export function StatsCard({
  label,
  value,
  valueColor = "text-text-primary",
}: StatsCardProps) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl tabular-nums ${valueColor}`}>
        {value}
      </p>
    </Card>
  );
}
