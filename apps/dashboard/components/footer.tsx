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
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <p className="text-xs text-text-tertiary">
          Built with
        </p>
        <div className="flex items-center gap-4">
          {sponsors.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {s.name}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
