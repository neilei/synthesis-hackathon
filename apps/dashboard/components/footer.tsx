/**
 * Page footer with sponsor attribution links (Venice.ai, MetaMask, Uniswap, Protocol Labs).
 *
 * @module @veil/dashboard/components/footer
 */
const sponsors = [
  { name: "Venice.ai", url: "https://venice.ai" },
  { name: "MetaMask", url: "https://metamask.io" },
  { name: "Uniswap", url: "https://uniswap.org" },
  { name: "Protocol Labs", url: "https://protocol.ai" },
];

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
        <span>Built with</span>
        {sponsors.map((s, i) => (
          <span key={s.name}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-tertiary underline decoration-border hover:text-text-secondary hover:decoration-text-tertiary transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded-sm"
            >
              {s.name}
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            {i < sponsors.length - 1 && <span className="mx-0.5">·</span>}
          </span>
        ))}
      </div>
    </footer>
  );
}
