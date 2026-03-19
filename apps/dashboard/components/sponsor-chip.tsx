/**
 * Inline sponsor chip with brand logo + colored text.
 * Uses official brand colors (lightened where needed for WCAG AA on dark bg).
 *
 * Uses plain <img> instead of next/image — these are tiny static SVGs where
 * the Next.js Image component adds unnecessary React overhead with no benefit.
 *
 * @module @veil/dashboard/components/sponsor-chip
 */

type Sponsor = "venice" | "metamask" | "uniswap" | "protocol-labs";

/**
 * Per-sponsor config. `color` is the text color class.
 * `iconSize` is tuned for optical consistency — each SVG has different
 * content-to-viewBox ratios, so pixel sizes differ to look the same.
 */
const SPONSOR_CONFIG: Record<
  Sponsor,
  { logo: string; alt: string; color: string; iconSize: number }
> = {
  venice: {
    logo: "/sponsors/venice.svg",
    alt: "Venice.ai",
    // Venice Red #DD3300 lightened to #EE4400 for AA contrast (5.17:1 on #09090b)
    color: "text-[#EE4400]",
    // Keys logo fills its viewBox densely — smaller to match others optically
    iconSize: 12,
  },
  metamask: {
    logo: "/sponsors/metamask.svg",
    alt: "MetaMask",
    // Official Pumpkin Orange — 7.85:1 contrast, passes AA
    color: "text-[#F6851B]",
    iconSize: 14,
  },
  uniswap: {
    logo: "/sponsors/uniswap.svg",
    alt: "Uniswap",
    // Official Uniswap Pink — 5.24:1 contrast, passes AA
    color: "text-[#FF007A]",
    // Unicorn has whitespace padding in viewBox — 14px matches others
    iconSize: 14,
  },
  "protocol-labs": {
    logo: "/sponsors/protocol-labs.svg",
    alt: "Protocol Labs",
    // Official #1541BE too dark (2.4:1). Lightened to #6B8FD4 (6.16:1, AA pass)
    color: "text-[#6B8FD4]",
    // Isometric logo has ~30% dead space in viewBox — larger to compensate
    iconSize: 16,
  },
};

interface SponsorChipProps {
  sponsor: Sponsor;
  text: string;
  className?: string;
}

export function SponsorChip({
  sponsor,
  text,
  className = "",
}: SponsorChipProps) {
  const config = SPONSOR_CONFIG[sponsor];
  return (
    <span
      className={`inline-flex items-center gap-1 align-middle text-xs ${config.color} ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={config.logo}
        alt={config.alt}
        width={config.iconSize}
        height={config.iconSize}
        className="shrink-0"
      />
      {text}
    </span>
  );
}

export type { Sponsor };
