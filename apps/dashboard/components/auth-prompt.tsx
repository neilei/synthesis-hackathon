"use client";

import { Spinner } from "./ui/icons";

interface AuthPromptProps {
  authenticating: boolean;
  error: string | null;
  onAuthenticate: () => void;
}

export function AuthPrompt({ authenticating, error, onAuthenticate }: AuthPromptProps) {
  if (authenticating) {
    return (
      <span className="flex items-center gap-2 text-text-secondary">
        <Spinner className="h-4 w-4 animate-spin" />
        Authenticating wallet...
      </span>
    );
  }

  if (error) {
    return (
      <>
        <p className="text-sm text-accent-danger">{error}</p>
        <button
          onClick={onAuthenticate}
          className="mt-2 cursor-pointer rounded-lg border border-accent-positive px-5 py-2.5 min-h-[44px] text-sm font-medium text-accent-positive transition-colors hover:bg-accent-positive-dim active:bg-accent-positive/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
        >
          Retry Authentication
        </button>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-text-secondary">Wallet authentication required.</p>
      <button
        onClick={onAuthenticate}
        className="mt-2 cursor-pointer rounded-lg border border-accent-positive px-5 py-2.5 min-h-[44px] text-sm font-medium text-accent-positive transition-colors hover:bg-accent-positive-dim active:bg-accent-positive/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
      >
        Authenticate
      </button>
    </>
  );
}
