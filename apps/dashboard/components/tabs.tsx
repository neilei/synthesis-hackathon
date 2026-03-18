/**
 * Tab navigation bar for the three dashboard screens: Configure, Audit, Monitor.
 * Disables Audit and Monitor tabs until the agent has been deployed.
 *
 * @module @veil/dashboard/components/tabs
 */
"use client";

import { ConnectWallet } from "./connect-wallet";

export type TabId = "configure" | "audit" | "monitor";

interface Tab {
  id: TabId;
  label: string;
  disabled?: boolean;
}

interface TabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasDeployed: boolean;
}

export function Tabs({ activeTab, onTabChange, hasDeployed }: TabsProps) {
  const tabs: Tab[] = [
    { id: "configure", label: "Configure" },
    { id: "audit", label: "Audit", disabled: !hasDeployed },
    { id: "monitor", label: "Monitor" },
  ];

  return (
    <nav role="tablist" className="flex items-center gap-1 border-b border-border px-6">
      <div className="flex items-center gap-1 flex-1">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
            className={`relative px-4 py-3 text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-positive focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary rounded-sm ${isActive ? "text-text-primary" : isDisabled ? "text-text-tertiary cursor-not-allowed" : "text-text-secondary hover:text-text-primary cursor-pointer"}`}
          >
            {tab.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-positive" />
            )}
          </button>
        );
      })}
      </div>
      <ConnectWallet />
    </nav>
  );
}
