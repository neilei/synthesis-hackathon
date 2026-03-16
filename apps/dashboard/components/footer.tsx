/**
 * Page footer with sponsor attribution links (Venice, MetaMask, Uniswap, Protocol Labs).
 *
 * @module @veil/dashboard/components/footer
 */
const sponsors = [
  { name: "Venice", url: "https://venice.ai" },
  { name: "MetaMask", url: "https://metamask.io" },
  { name: "Uniswap", url: "https://uniswap.org" },
  { name: "Protocol Labs", url: "https://protocol.ai" },
];

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1 gap-y-1 text-xs text-text-tertiary">
        <span>Built with</span>
        {sponsors.map((s, i) => (
          <span key={s.name}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {s.name}
            </a>
            {i < sponsors.length - 1 && <span className="mx-0.5">·</span>}
          </span>
        ))}
      </div>
    </footer>
  );
}
