/**
 * Multi-step intent configuration flow:
 * 1. Enter intent text (+ presets)
 * 2. Preview parsed intent (calls POST /api/parse-intent)
 * 3. Review audit report inline
 * 4. Sign delegation + submit (calls POST /api/intents)
 *
 * @module @veil/dashboard/components/configure
 */
"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/use-auth";
import { useDelegation } from "@/hooks/use-delegation";
import { parseIntent, createIntent, type IntentRecord } from "@/lib/api";
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { AuditListItem } from "./ui/audit-list-item";
import { AllocationBar } from "./allocation-bar";
import { StrategyDetails } from "./strategy-details";
import { DelegationDetails } from "./delegation-details";
import { Spinner, WarningIcon } from "./ui/icons";
import { SponsorBadge } from "./sponsor-badge";
import type { ParsedIntent, AuditReport } from "@veil/common";

type Step = "input" | "parsing" | "preview" | "signing" | "submitting";

interface ConfigureProps {
  onSuccess: (intent: IntentRecord, audit: AuditReport) => void;
}

const PRESETS = [
  "60/40 ETH/USDC, $200/day, 7 days",
  "80/20 ETH/USDC, conservative, 30 days",
  "50/50 split, $100/day, rebalance at 10% drift",
] as const;

export function Configure({ onSuccess }: ConfigureProps) {
  const { isConnected } = useAccount();
  const { token, isAuthenticated, authenticating } = useAuth();
  const { signDelegation, signing } = useDelegation();

  const [intentText, setIntentText] = useState("");
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);

  const handlePreview = useCallback(async () => {
    if (!intentText.trim()) return;
    setStep("parsing");
    setError(null);
    try {
      const result = await parseIntent(intentText.trim());
      setParsed(result.parsed);
      setAudit(result.audit);
      setStep("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to parse intent";
      setError(msg);
      setStep("input");
    }
  }, [intentText]);

  const handleDeploy = useCallback(async () => {
    if (!parsed || !token) return;
    setError(null);

    // Step 1: Sign delegation
    setStep("signing");
    const delegation = await signDelegation(parsed);
    if (!delegation) {
      setError("Delegation signing failed");
      setStep("preview");
      return;
    }

    // Step 2: Submit to backend
    setStep("submitting");
    try {
      const result = await createIntent(token, {
        intentText: intentText.trim(),
        parsedIntent: parsed,
        signedDelegation: delegation.signedDelegation,
        delegatorSmartAccount: delegation.delegatorSmartAccount,
        permissionsContext: delegation.permissionsContext,
        delegationManager: delegation.delegationManager,
      });
      onSuccess(result.intent, result.audit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create intent";
      setError(msg);
      setStep("preview");
    }
  }, [parsed, token, signDelegation, intentText, onSuccess]);

  const handleReset = useCallback(() => {
    setParsed(null);
    setAudit(null);
    setStep("input");
    setError(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (step === "input") handlePreview();
      }
    },
    [step, handlePreview],
  );

  const isParsing = step === "parsing";
  const isBusy = step === "signing" || step === "submitting";
  const isEmpty = intentText.trim().length === 0;

  const statusLabel = (() => {
    switch (step) {
      case "parsing": return "Analyzing your strategy...";
      case "signing": return "Signing delegation...";
      case "submitting": return "Submitting intent...";
      default: return null;
    }
  })();

  return (
    <div className="flex items-start justify-center px-4 pt-16 pb-24 sm:pt-24">
      <div className="w-full max-w-[640px]">
        {/* Wordmark */}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold tracking-[0.3em] text-accent-positive sm:text-6xl">
            VEIL
          </h1>
          <p className="mt-3 text-sm uppercase tracking-widest text-text-secondary">
            Describe your portfolio. The agent handles the rest.
          </p>
        </div>

        {/* Intent input card */}
        <Card className="p-5">
          <textarea
            aria-label="Describe your portfolio strategy"
            value={intentText}
            onChange={(e) => {
              setIntentText(e.target.value);
              // Reset preview when editing
              if (step === "preview") handleReset();
            }}
            onKeyDown={handleKeyDown}
            placeholder="60/40 ETH/USDC, $200/day, 7 days"
            rows={3}
            disabled={isParsing || isBusy}
            className="w-full resize-none rounded-lg border border-border bg-bg-primary px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-positive focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:opacity-50"
          />

          {/* Preview button (before parsing) */}
          {step === "input" && (
            <button
              onClick={handlePreview}
              disabled={isEmpty}
              className="mt-4 flex w-full cursor-pointer items-center justify-center rounded-lg border border-accent-positive px-4 py-3 text-sm font-semibold uppercase tracking-widest text-accent-positive transition-colors hover:bg-accent-positive-dim active:bg-accent-positive/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Preview Strategy
            </button>
          )}

          {/* Loading state */}
          <div role="status" aria-live="polite">
            {statusLabel && (
              <div className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-text-secondary">
                <Spinner className="h-4 w-4 animate-spin" />
                {statusLabel}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p role="alert" className="mt-3 text-sm text-accent-danger">{error}</p>
          )}
        </Card>

        {/* Preset pills (only in input step) */}
        {step === "input" && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setIntentText(preset)}
                disabled={isParsing}
                className="cursor-pointer rounded-full border border-border px-3 py-2.5 font-mono text-xs text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:cursor-not-allowed disabled:opacity-40"
              >
                {preset}
              </button>
            ))}
          </div>
        )}

        {/* Preview section */}
        {parsed && step !== "parsing" && (
          <div className="mt-6 space-y-4">
            {/* Strategy preview */}
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <SectionHeading>Your Strategy</SectionHeading>
                <button
                  onClick={handleReset}
                  disabled={isBusy}
                  className="text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded-sm cursor-pointer"
                >
                  Edit
                </button>
              </div>

              <div className="mt-4">
                <AllocationBar allocation={parsed.targetAllocation} size="lg" />
              </div>

              <div className="mt-5">
                <StrategyDetails parsed={parsed} showDriftThreshold />
              </div>

              <div className="mt-4 border-t border-border-subtle pt-3">
                <SponsorBadge text="Powered by Venice" />
              </div>
            </Card>

            {/* Audit report */}
            {audit && (
              <Card className="p-5">
                <SectionHeading>Delegation Report</SectionHeading>
                <div className="mt-4 space-y-4">
                  {audit.allows.length > 0 && (
                    <div>
                      <SectionHeading size="xs" as="h3" className="mb-2 text-accent-positive">
                        Allows
                      </SectionHeading>
                      <ul className="space-y-2">
                        {audit.allows.map((item, i) => (
                          <AuditListItem key={i} variant="allows">
                            {item}
                          </AuditListItem>
                        ))}
                      </ul>
                    </div>
                  )}

                  {audit.prevents.length > 0 && (
                    <div>
                      <SectionHeading size="xs" as="h3" className="mb-2 text-accent-danger">
                        Prevents
                      </SectionHeading>
                      <ul className="space-y-2">
                        {audit.prevents.map((item, i) => (
                          <AuditListItem key={i} variant="prevents">
                            {item}
                          </AuditListItem>
                        ))}
                      </ul>
                    </div>
                  )}

                  {audit.worstCase && (
                    <div>
                      <SectionHeading size="xs" as="h3" className="mb-2 text-accent-warning">
                        Worst Case
                      </SectionHeading>
                      <div className="flex items-start gap-2 rounded bg-accent-warning-dim px-3 py-2 text-sm text-text-primary">
                        <WarningIcon />
                        <span>{audit.worstCase}</span>
                      </div>
                    </div>
                  )}

                  {audit.warnings.length > 0 && (
                    <div>
                      <SectionHeading size="xs" as="h3" className="mb-2 text-accent-warning">
                        Warnings
                      </SectionHeading>
                      <ul className="space-y-2">
                        {audit.warnings.map((item, i) => (
                          <AuditListItem key={i} variant="warning">
                            {item}
                          </AuditListItem>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="mt-4 border-t border-border-subtle pt-3">
                  <SponsorBadge text="Enforced by MetaMask Delegation" />
                </div>
              </Card>
            )}

            {/* Delegation Details */}
            <DelegationDetails parsed={parsed} />

            {/* Deploy button */}
            {step === "preview" && (
              <div>
                {!isConnected ? (
                  <p className="text-center text-sm text-text-secondary">
                    Connect your wallet to deploy the agent.
                  </p>
                ) : !isAuthenticated ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-text-secondary">
                    {authenticating ? (
                      <>
                        <Spinner className="h-4 w-4 animate-spin" />
                        Authenticating wallet...
                      </>
                    ) : (
                      "Wallet authentication required."
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleDeploy}
                    disabled={signing || isBusy}
                    className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-accent-positive px-4 py-3 text-sm font-semibold uppercase tracking-widest text-bg-primary transition-colors hover:bg-accent-positive/90 active:bg-accent-positive/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Deploy Agent
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
