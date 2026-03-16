"use client";

import { useEffect, useRef } from "react";
import type { AgentLogEntry } from "@veil/common";
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { SponsorBadge } from "./sponsor-badge";
import { CycleGroup } from "./cycle-group";
import { groupFeedByCycle } from "@/lib/group-feed";

interface ActivityFeedProps {
  feed: AgentLogEntry[];
}

export function ActivityFeed({ feed }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    wasAtBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [feed]);

  const groups = groupFeedByCycle(feed);

  return (
    <Card className="flex flex-col p-5">
      <SectionHeading className="mb-3">Activity Feed</SectionHeading>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-1 overflow-y-auto"
        style={{ maxHeight: "400px" }}
      >
        {groups.length > 0 ? (
          groups.map((group) => (
            <CycleGroup
              key={group.cycle ?? "init"}
              group={group}
              defaultExpanded={group === groups[groups.length - 1]}
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
      <div className="mt-5 border-t border-border-subtle pt-3">
        <SponsorBadge text="Powered by Venice" />
      </div>
    </Card>
  );
}
