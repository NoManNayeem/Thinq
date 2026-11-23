"use client";

import { CheckCircle2Icon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { FilterTabs } from "@/components/common/filter-tabs";
import { IconTile, Page, PageHeader } from "@/components/common/page";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { StatusBadge } from "@/components/documents/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/client";
import { useAttention, useLatestScan, useScanDocuments } from "@/lib/api/queries";
import { flagMeta, SEVERITY, severityBadge } from "@/lib/documents";
import { plural, relativeTime } from "@/lib/format";

type Severity = "all" | "critical" | "warning" | "info";

export function AttentionScreen() {
  const attention = useAttention();
  const latest = useLatestScan();
  const scan = useScanDocuments();
  const [severity, setSeverity] = useState<Severity>("all");
  const items = attention.data ?? [];
  const count = (s: Exclude<Severity, "all">) =>
    items.filter((i) => i.flags.some((f) => f.severity === s)).length;
  const shown =
    severity === "all" ? items : items.filter((i) => i.flags.some((f) => f.severity === severity));

  const runScan = () =>
    scan.mutate(undefined, {
      onSuccess: (result) => {
        const s = result.stats as {
          created?: string[];
          updated?: string[];
          missing?: string[];
          unchanged?: number;
        };
        toast.success("Scan complete", {
          description: `${s.created?.length ?? 0} new · ${s.updated?.length ?? 0} changed · ${s.missing?.length ?? 0} missing · ${s.unchanged ?? 0} unchanged`,
        });
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <Page>
      <PageHeader
        title="Needs attention"
        description="Documents whose owner, status or access isn't reliable yet. Fixing the cause clears the flag."
        meta={
          latest.data && (
            <span className="text-muted-foreground text-xs">
              Sources last scanned{" "}
              {relativeTime(latest.data.finished_at ?? latest.data.started_at).toLowerCase()}
            </span>
          )
        }
        actions={
          <Button onClick={runScan} disabled={scan.isPending}>
            {scan.isPending ? <Spinner /> : <RefreshCwIcon />}
            Re-scan sources
          </Button>
        }
      />

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label="Flagged documents">
        <div className="border-b p-4 md:px-6">
          <FilterTabs
            label="Severity"
            value={severity}
            onChange={setSeverity}
            className="w-full sm:w-auto"
            options={[
              { value: "all", label: "All", count: attention.data ? items.length : undefined },
              { value: "critical", label: "Critical", count: attention.data ? count("critical") : undefined },
              { value: "warning", label: "Warnings", count: attention.data ? count("warning") : undefined },
              { value: "info", label: "Info", count: attention.data ? count("info") : undefined },
            ]}
          />
        </div>
        {attention.isPending ? (
          <ListSkeleton rows={5} />
        ) : attention.isError ? (
          <div className="p-4">
            <ErrorState error={attention.error} onRetry={() => attention.refetch()} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={CheckCircle2Icon}
            title={items.length === 0 ? "Everything looks good" : "Nothing at this level"}
            description={
              items.length === 0
                ? "Every document you can see has an owner, a status and an access group."
                : undefined
            }
          />
        ) : (
          <ul className="divide-y" data-testid="attention-list">
            {shown.map((item) => {
              const top = item.flags[0];
              if (!top) return null;
              const meta = flagMeta(top.kind);
              const sev = SEVERITY[top.severity];
              return (
                <li key={item.id}>
                  <Link
                    href={`/library/${item.id}`}
                    className="flex items-start gap-4 px-4 py-4 outline-none transition-colors hover:bg-muted focus-visible:bg-muted md:px-6"
                    data-testid={`attention-${item.source_path}`}
                  >
                    <IconTile icon={meta.icon} tone={sev.tone} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{item.title}</span>
                        <StatusBadge status={item.status} />
                      </span>
                      <span className="text-sm">
                        <span className="font-medium">{meta.label}.</span>{" "}
                        <span className="text-muted-foreground">{top.message}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {item.flags.map((f) => (
                          <Badge key={f.id} variant={severityBadge(f.severity)}>
                            {flagMeta(f.kind).label}
                          </Badge>
                        ))}
                      </span>
                    </span>
                    <span className="hidden text-muted-foreground text-xs sm:block">
                      {plural(item.flags.length, "flag")}
                    </span>
                    <ChevronRightIcon className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}
