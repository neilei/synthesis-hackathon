"use client";

import { Spinner } from "./ui/icons";
import { Button } from "./ui/button";

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
        <Button variant="outline" size="md" onClick={onAuthenticate} className="mt-2">
          Retry Authentication
        </Button>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-text-secondary">Wallet authentication required.</p>
      <Button variant="outline" size="md" onClick={onAuthenticate} className="mt-2">
        Authenticate
      </Button>
    </>
  );
}
