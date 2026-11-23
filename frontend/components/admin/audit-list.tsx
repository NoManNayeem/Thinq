"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { AuditEvent } from "@/lib/api/client";
import { auditDescription, auditLabel, auditTone } from "@/lib/audit";
import { auditIcon } from "@/lib/audit-icons";
import { dateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TONE_ICON = {
  default: "bg-secondary text-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
} as const;

export function AuditIcon({ action }: { action: string }) {
  const Icon = auditIcon(action);
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        TONE_ICON[auditTone(action)],
      )}
      aria-hidden
    >
      <Icon className="size-4" />
    </span>
  );
}

export function AuditTimeline({
  events,
  loading,
  empty = "No activity yet.",
  showTarget = true,
}: {
  events: AuditEvent[] | undefined;
  loading: boolean;
  empty?: string;
  showTarget?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6" role="status" aria-label="Loading">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }
  if (!events || events.length === 0)
    return <p className="px-6 py-8 text-muted-foreground text-sm">{empty}</p>;
  return (
    <ol className="divide-y">
      {events.map((e) => {
        const description = auditDescription(e);
        return (
          <li key={e.id} className="flex gap-4 px-4 py-4 md:px-6">
            <AuditIcon action={e.action} />
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <p className="truncate">
                <span className="font-medium">{auditLabel(e.action)}</span>
                {showTarget && e.target_label && (
                  <span className="text-muted-foreground"> · {e.target_label}</span>
                )}
              </p>
              {description && <p className="truncate text-muted-foreground">{description}</p>}
              <p className="text-muted-foreground text-xs">
                {e.actor_label} ·{" "}
                <time dateTime={e.occurred_at} title={dateTime(e.occurred_at)}>
                  {relativeTime(e.occurred_at)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
