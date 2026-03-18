interface SectionHeadingProps {
  children: React.ReactNode;
  size?: "sm" | "xs";
  as?: "h2" | "h3" | "h4";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "text-sm font-medium uppercase tracking-wider text-text-secondary",
  xs: "text-xs font-semibold uppercase tracking-wider",
} as const;

export function SectionHeading({
  children,
  size = "sm",
  as: Tag = "h2",
  className = "",
}: SectionHeadingProps) {
  return (
    <Tag className={`${SIZE_CLASSES[size]} ${className}`}>{children}</Tag>
  );
}
