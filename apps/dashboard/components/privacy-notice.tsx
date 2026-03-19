export function PrivacyNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs text-text-tertiary ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-3 w-3 text-accent-secondary shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z"
          clipRule="evenodd"
        />
      </svg>
      <span>AI reasoning is end-to-end encrypted and only viewable by the agent owner</span>
    </div>
  );
}
