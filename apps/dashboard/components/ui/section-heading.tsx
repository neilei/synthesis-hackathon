interface SectionHeadingProps {
  children: React.ReactNode;
  size?: "sm" | "xs";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "text-sm font-medium uppercase tracking-wider text-text-secondary",
  xs: "text-xs font-semibold uppercase tracking-wider",
} as const;

export function SectionHeading({
  children,
  size = "sm",
  className = "",
}: SectionHeadingProps) {
  return (
    <h2 className={`${SIZE_CLASSES[size]} ${className}`}>{children}</h2>
  );
}
