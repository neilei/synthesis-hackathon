/**
 * Home page. Manages tab state and coordinates data flow between Configure
 * and Monitor screens.
 *
 * @module @maw/dashboard/app/page
 */
"use client";

import { useState, useCallback } from "react";
import { Tabs, type TabId } from "@/components/tabs";
import { Configure } from "@/components/configure";
import { Monitor } from "@/components/monitor";
import { Footer } from "@/components/footer";
import { ErrorBoundary } from "@/components/error-boundary";

function getInitialTab(): TabId {
  if (typeof window === "undefined") return "configure";
  const params = new URLSearchParams(window.location.search);
  if (params.has("intent") || params.get("tab") === "monitor") return "monitor";
  if (params.get("tab") === "configure") return "configure";
  return "configure";
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab);

  const handleDeploySuccess = useCallback(
    () => setActiveTab("monitor"),
    [],
  );

  const handleNavigateConfigure = useCallback(() => {
    setActiveTab("configure");
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent-positive focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-bg-primary"
      >
        Skip to main content
      </a>

      <Tabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <main id="main" className="flex-1">
        <div
          id="panel-configure"
          role="tabpanel"
          aria-labelledby="tab-configure"
          hidden={activeTab !== "configure"}
        >
          {activeTab === "configure" && (
            <ErrorBoundary>
              <Configure onSuccess={handleDeploySuccess} />
            </ErrorBoundary>
          )}
        </div>
        <div
          id="panel-monitor"
          role="tabpanel"
          aria-labelledby="tab-monitor"
          hidden={activeTab !== "monitor"}
        >
          {activeTab === "monitor" && (
            <ErrorBoundary>
              <Monitor onNavigateConfigure={handleNavigateConfigure} />
            </ErrorBoundary>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
