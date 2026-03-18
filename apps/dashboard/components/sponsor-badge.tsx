/**
 * Inline sponsor credit badge with dot indicator. Used in section headers
 * to attribute sponsor technology.
 *
 * @module @veil/dashboard/components/sponsor-badge
 */
interface SponsorBadgeProps {
  text: string;
}

export function SponsorBadge({ text }: SponsorBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
      <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-text-tertiary" />
      {text}
    </span>
  );
}
