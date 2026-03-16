interface PulsingDotProps {
  size?: "sm" | "md";
}

const SIZE_MAP = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
} as const;

export function PulsingDot({ size = "md" }: PulsingDotProps) {
  const sizeClass = SIZE_MAP[size];
  return (
    <span className={`relative flex ${sizeClass}`}>
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-positive opacity-75`}
      />
      <span
        className={`relative inline-flex ${sizeClass} rounded-full bg-accent-positive`}
      />
    </span>
  );
}
