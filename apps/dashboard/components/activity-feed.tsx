"use client";

import { useMemo } from "react";

import type { AgentLogEntry } from "@veil/common";
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { CycleGroup } from "./cycle-group";
import { groupFeedByCycle } from "@/lib/group-feed";

interface ActivityFeedProps {
  feed: AgentLogEntry[];
}

export function ActivityFeed({ feed }: ActivityFeedProps) {
  // Reverse so newest cycles appear at the top
  const groups = useMemo(() => groupFeedByCycle(feed).reverse(), [feed]);

  return (
    <Card className="flex flex-col p-5">
      <SectionHeading className="mb-3">Activity Feed</SectionHeading>
      <div
        role="log"
        aria-label="Agent activity feed"
        aria-relevant="additions"
        tabIndex={0}
        className="flex-1 space-y-1 overflow-y-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded max-h-[50vh] sm:max-h-[400px]"
      >
        {groups.length > 0 ? (
          groups.map((group) => (
            <CycleGroup
              key={group.cycle ?? "init"}
              group={group}
              defaultExpanded={group === groups[0]}
            />
          ))
        ) : (
          <div className="flex h-full items-center justify-center py-12">
            <p className="text-sm text-text-tertiary">
              Waiting for the agent&apos;s first cycle...
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
