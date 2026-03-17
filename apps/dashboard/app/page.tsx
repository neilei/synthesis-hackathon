/**
 * Home page. Manages tab state and coordinates data flow between Configure,
 * Audit, and Monitor screens.
 *
 * @module @veil/dashboard/app/page
 */
"use client";

import { useState, useCallback } from "react";
import { Tabs, type TabId } from "@/components/tabs";
import { Configure } from "@/components/configure";
import { Audit } from "@/components/audit";
import { Monitor } from "@/components/monitor";
import { Footer } from "@/components/footer";
import type { AuditReport, ParsedIntent } from "@veil/common";
import type { IntentRecord } from "@/lib/api";

interface DeployedState {
  intent: IntentRecord;
  parsed: ParsedIntent;
  audit: AuditReport;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("configure");
  const [deployedState, setDeployedState] = useState<DeployedState | null>(null);

  const handleDeploySuccess = useCallback(
    (intent: IntentRecord, audit: AuditReport) => {
      const parsed: ParsedIntent = JSON.parse(intent.parsedIntent);
      setDeployedState({ intent, parsed, audit });
      setActiveTab("audit");
    },
    [],
  );

  const handleViewMonitor = useCallback(() => {
    setActiveTab("monitor");
  }, []);

  const handleNavigateConfigure = useCallback(() => {
    setActiveTab("configure");
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Tabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasDeployed={deployedState !== null}
      />

      <main className="flex-1">
        {activeTab === "configure" && (
          <Configure onSuccess={handleDeploySuccess} />
        )}
        {activeTab === "audit" && deployedState && (
          <Audit
            data={{ parsed: deployedState.parsed, audit: deployedState.audit }}
            onViewMonitor={handleViewMonitor}
          />
        )}
        {activeTab === "monitor" && (
          <Monitor onNavigateConfigure={handleNavigateConfigure} />
        )}
      </main>

      <Footer />
    </div>
  );
}
