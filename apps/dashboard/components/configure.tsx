/**
 * Multi-step intent configuration flow:
 * 1. Enter intent text (+ presets)
 * 2. Preview parsed intent (calls POST /api/parse-intent)
 * 3. Review audit report inline
 * 4. Request ERC-7715 permissions via MetaMask Flask + submit (calls POST /api/intents)
 *
 * @module @veil/dashboard/components/configure
 */
"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { parseIntent, createIntent, type IntentRecord } from "@/lib/api";
import { Card } from "./ui/card";
import { CardFooter } from "./ui/card-footer";
import { Button } from "./ui/button";
import { SectionHeading } from "./ui/section-heading";
import { AllocationBar } from "./allocation-bar";
import { StrategyDetails } from "./strategy-details";
import { DelegationDetails } from "./delegation-details";
import { AuditReportSection } from "./audit-report-section";
import { Spinner } from "./ui/icons";
import { SponsorChip } from "./sponsor-chip";
import { AuthPrompt } from "./auth-prompt";
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
  const { token, isAuthenticated, authenticating, authenticate, error: authError } = useAuth();
  const { requestPermissions, requesting } = usePermissions();

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

    // Step 1: Request ERC-7715 permissions via MetaMask Flask
    setStep("signing");
    const result = await requestPermissions(parsed);
    if (!result) {
      setError("Permission request failed or was rejected.");
      setStep("preview");
      return;
    }

    // Step 2: Submit to backend with permissions
    setStep("submitting");
    try {
      const response = await createIntent(token, {
        intentText: intentText.trim(),
        parsedIntent: parsed,
        permissions: JSON.stringify(result.permissions),
        delegationManager: result.delegationManager,
        dependencies: JSON.stringify(result.dependencies),
      });
      onSuccess(response.intent, response.audit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create intent";
      setError(msg);
      setStep("preview");
    }
  }, [parsed, token, requestPermissions, intentText, onSuccess]);

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
      case "signing": return "Requesting permissions in MetaMask Flask...";
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
            <Button
              variant="outline"
              size="md"
              onClick={handlePreview}
              disabled={isEmpty}
              className="mt-4 w-full font-semibold uppercase tracking-widest"
            >
              Preview Strategy
            </Button>
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
                className="cursor-pointer rounded-full border border-border px-3 py-2.5 min-h-[44px] font-mono text-xs text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive disabled:cursor-not-allowed disabled:opacity-50"
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
                <Button variant="text" onClick={handleReset} disabled={isBusy} className="text-text-tertiary hover:text-text-secondary">
                  Edit
                </Button>
              </div>

              <div className="mt-4">
                <AllocationBar allocation={parsed.targetAllocation} size="lg" />
              </div>

              <div className="mt-5">
                <StrategyDetails parsed={parsed} showDriftThreshold />
              </div>

              <CardFooter>
                <SponsorChip sponsor="venice" text="Powered by Venice.ai" />
              </CardFooter>
            </Card>

            {/* Audit report */}
            {audit && (
              <Card className="p-5">
                <SectionHeading>Permission Report</SectionHeading>
                <div className="mt-4">
                  <AuditReportSection audit={audit} />
                </div>
                <CardFooter>
                  <SponsorChip sponsor="metamask" text="Enforced by MetaMask Delegation" />
                </CardFooter>
              </Card>
            )}

            {/* Permission Details */}
            <DelegationDetails parsed={parsed} />

            {/* Deploy button */}
            {step === "preview" && (
              <div>
                {!isConnected ? (
                  <p className="text-center text-sm text-text-secondary">
                    Connect your wallet to deploy the agent.
                  </p>
                ) : !isAuthenticated ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-sm">
                    <AuthPrompt authenticating={authenticating} error={authError} onAuthenticate={authenticate} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button
                      variant="solid"
                      size="md"
                      onClick={handleDeploy}
                      disabled={requesting || isBusy}
                      className="w-full font-semibold uppercase tracking-widest"
                    >
                      Grant Permissions &amp; Deploy
                    </Button>
                    <p className="text-center text-xs text-text-tertiary">
                      Requires MetaMask Flask (v13.5+). Judges without Flask can view pre-built agents under Monitor.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
