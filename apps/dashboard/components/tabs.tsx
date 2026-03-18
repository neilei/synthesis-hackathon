/**
 * Tab navigation bar for the dashboard screens: Configure and Monitor.
 *
 * @module @veil/dashboard/components/tabs
 */
"use client";

import { useRef, useCallback } from "react";
import { ConnectWallet } from "./connect-wallet";

export type TabId = "configure" | "monitor";

interface Tab {
  id: TabId;
  label: string;
  disabled?: boolean;
}

interface TabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TAB_LIST: Tab[] = [
  { id: "configure", label: "Configure" },
  { id: "monitor", label: "Monitor" },
];

export function Tabs({ activeTab, onTabChange }: TabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const enabledTabs = TAB_LIST.filter((t) => !t.disabled);
      if (enabledTabs.length === 0) return;
      const currentIdx = enabledTabs.findIndex((t) => t.id === activeTab);
      let nextIdx = currentIdx === -1 ? 0 : currentIdx;

      if (e.key === "ArrowRight") {
        nextIdx = (currentIdx + 1) % enabledTabs.length;
      } else if (e.key === "ArrowLeft") {
        nextIdx = (currentIdx - 1 + enabledTabs.length) % enabledTabs.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = enabledTabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      const nextTab = enabledTabs[nextIdx];
      onTabChange(nextTab.id);
      // Focus the target tab button
      const globalIdx = TAB_LIST.findIndex((t) => t.id === nextTab.id);
      tabRefs.current[globalIdx]?.focus();
    },
    [activeTab, onTabChange],
  );

  return (
    <nav
      role="tablist"
      aria-label="Dashboard navigation"
      onKeyDown={handleKeyDown}
      className="flex items-center gap-1 border-b border-border px-6"
    >
      <div className="flex items-center gap-1 flex-1">
        {TAB_LIST.map((tab, i) => {
          const isActive = activeTab === tab.id;
          const isDisabled = tab.disabled;

          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              disabled={isDisabled}
              className={`relative px-4 py-3 min-h-[44px] text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-positive focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary rounded-sm ${isActive ? "text-text-primary" : isDisabled ? "text-text-tertiary cursor-not-allowed" : "text-text-secondary hover:text-text-primary cursor-pointer"}`}
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
