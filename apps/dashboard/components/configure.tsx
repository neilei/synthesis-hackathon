/**
 * Intent input form with preset strategies. Submits to /api/deploy and
 * transitions to the Audit tab on success.
 *
 * @module @veil/dashboard/components/configure
 */
"use client";

import { useState, useCallback } from "react";
import { useDeploy } from "@/hooks/use-deploy";
import type { DeployResponse } from "@/lib/types";

interface ConfigureProps {
  onSuccess: (data: DeployResponse) => void;
}

const PRESETS = [
  "60/40 ETH/USDC, $200/day, 7 days",
  "80/20 ETH/USDC, conservative, 30 days",
  "50/50 split, $100/day, rebalance at 10% drift",
] as const;

export function Configure({ onSuccess }: ConfigureProps) {
  const [intent, setIntent] = useState("");
  const { error, loading, deploy } = useDeploy();

  const handleSubmit = useCallback(async () => {
    if (!intent.trim() || loading) return;
    try {
      const result = await deploy(intent.trim());
      onSuccess(result);
    } catch {
      // Error state is handled by the useDeploy hook
    }
  }, [intent, loading, deploy, onSuccess]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isEmpty = intent.trim().length === 0;

  return (
    <div className="flex items-start justify-center px-4 pt-16 pb-24 sm:pt-24">
      <div className="w-full max-w-[640px]">
        {/* Wordmark */}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold tracking-[0.3em] text-accent-positive sm:text-6xl">
            VEIL
          </h1>
          <p className="mt-3 text-sm uppercase tracking-widest text-text-secondary">
            Intent-Compiled Private DeFi Agent
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-border bg-bg-surface p-6">
          {/* Textarea */}
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="60/40 ETH/USDC, $200/day, 7 days"
            rows={3}
            disabled={loading}
            className="w-full resize-none rounded-lg border border-border bg-bg-primary px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-positive focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:opacity-50"
          />

          {/* Deploy button */}
          <button
            onClick={handleSubmit}
            disabled={isEmpty || loading}
            className="mt-4 flex w-full cursor-pointer items-center justify-center rounded-lg border border-accent-positive px-4 py-3 text-sm font-semibold uppercase tracking-widest text-accent-positive transition-colors hover:bg-accent-positive-dim active:bg-accent-positive/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {loading ? (
              <>
                <svg
                  className="mr-2 h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Compiling intent via Venice AI...
              </>
            ) : (
              "Compile & Deploy"
            )}
          </button>

          {/* Error message */}
          {error && (
            <p className="mt-3 text-sm text-accent-danger">{error}</p>
          )}
        </div>

        {/* Preset pills */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setIntent(preset)}
              disabled={loading}
              className="cursor-pointer rounded-full border border-border px-3 py-1.5 font-mono text-xs text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:cursor-not-allowed disabled:opacity-40"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
