"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { ChevronDownIcon, DownloadIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import { AuditIcon } from "@/components/admin/audit-list";
import { FilterTabs } from "@/components/common/filter-tabs";
import { Page, PageHeader } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AuditEvent } from "@/lib/api/client";
import { fetchAuditPage, keys } from "@/lib/api/queries";
import { AUDIT_FILTERS, auditDescription, auditLabel } from "@/lib/audit";
import { dateTime } from "@/lib/format";

type Filter = (typeof AUDIT_FILTERS)[number]["value"];

function dayLabel(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMMM yyyy");
}

function groupByDay(events: AuditEvent[]) {
  const days: { label: string; events: AuditEvent[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.occurred_at);
    const last = days.at(-1);
    if (last?.label === label) last.events.push(e);
    else days.push({ label, events: [e] });
  }
  return days;
}

function toCsv(events: AuditEvent[]) {
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = [
    ["Time (UTC)", "Event", "Details", "Target", "By", "IP address"],
    ...events.map((e) => [
      e.occurred_at,
      auditLabel(e.action),
      auditDescription(e),
      e.target_label,
      e.actor_label,
      e.ip_address,
    ]),
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

function download(events: AuditEvent[]) {
  const blob = new Blob([toCsv(events)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `thinq-audit-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const params = { action: filter === "all" ? undefined : filter, limit: 50 };
  const audit = useInfiniteQuery({
    queryKey: [...keys.audit(params), "infinite"],
    queryFn: ({ pageParam }) => fetchAuditPage({ ...params, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const events = audit.data?.pages.flatMap((p) => p.items) ?? [];
  const options = AUDIT_FILTERS.map((f) => ({ value: f.value, label: f.label }));

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="A permanent record of sign-ins and every change to people, roles and groups."
        actions={
          <Button variant="outline" onClick={() => download(events)} disabled={events.length === 0}>
            <DownloadIcon />
            Export CSV
          </Button>
        }
      />

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label="Audit events">
        <div className="border-b p-4 md:px-6">
          <FilterTabs
            label="Filter activity"
            value={filter}
            onChange={setFilter}
            options={options}
            className="hidden lg:inline-flex"
          />
          <div className="lg:hidden">
            <SimpleSelect label="Filter activity" value={filter} onChange={setFilter} options={options} />
          </div>
        </div>

        {audit.isPending ? (
          <ListSkeleton rows={8} />
        ) : audit.isError ? (
          <div className="p-4">
            <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={ScrollTextIcon}
            title="No activity recorded"
            description="Try a different filter."
          />
        ) : (
          groupByDay(events).map((day) => (
            <div key={day.label}>
              <h2 className="sticky top-16 z-10 border-b bg-muted px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide md:px-6">
                {day.label}
              </h2>
              <ol className="divide-y">
                {day.events.map((e) => {
                  const description = auditDescription(e);
                  return (
                    <li
                      key={e.id}
                      className="flex items-start gap-4 px-4 py-4 md:px-6"
                      data-testid="audit-row"
                      data-action={e.action}
                    >
                      <AuditIcon action={e.action} />
                      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm md:flex-row md:items-center md:gap-6">
                        <div className="min-w-0 md:flex-1">
                          <p className="font-medium">{auditLabel(e.action)}</p>
                          {description && <p className="truncate text-muted-foreground">{description}</p>}
                        </div>
                        <p className="truncate text-muted-foreground md:w-56">{e.target_label ?? "—"}</p>
                        <p className="truncate text-muted-foreground md:w-56">by {e.actor_label}</p>
                      </div>
                      <time
                        dateTime={e.occurred_at}
                        title={dateTime(e.occurred_at)}
                        className="shrink-0 text-muted-foreground text-xs tabular"
                      >
                        {format(parseISO(e.occurred_at), "HH:mm")}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))
        )}

        {audit.hasNextPage && (
          <div className="flex justify-center border-t p-4">
            <Button
              variant="outline"
              onClick={() => audit.fetchNextPage()}
              disabled={audit.isFetchingNextPage}
            >
              {audit.isFetchingNextPage ? <Spinner /> : <ChevronDownIcon />}
              Load older events
            </Button>
          </div>
        )}
      </section>
    </Page>
  );
}
