"use client";

import { LibraryIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { FilterTabs } from "@/components/common/filter-tabs";
import { IconInput } from "@/components/common/inputs";
import { Page, PageHeader } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { DocumentRow } from "@/components/documents/document-row";
import { useCurrentUser } from "@/components/shell/current-user";
import { useDebounced } from "@/hooks/use-debounced";
import type { DocumentStatus } from "@/lib/api/client";
import { useDocuments } from "@/lib/api/queries";
import { STATUS, STATUS_ORDER } from "@/lib/documents";

type StatusFilter = "all" | DocumentStatus;

export function LibraryScreen() {
  const { user } = useCurrentUser();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [groupId, setGroupId] = useState("all");
  const query = useDebounced(q.trim());
  const docs = useDocuments({
    q: query || undefined,
    status: status === "all" ? undefined : status,
    group_id: groupId === "all" ? undefined : groupId,
    limit: 500,
  });
  const counts = docs.data?.status_counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const statusOptions: { value: StatusFilter; label: string; count?: number }[] = [
    { value: "all", label: "All", count: docs.data ? all : undefined },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: s === "unknown" ? "Unknown" : STATUS[s].label,
      count: docs.data ? (counts[s] ?? 0) : undefined,
    })),
  ];
  const filtered = Boolean(query) || status !== "all" || groupId !== "all";

  return (
    <Page>
      <PageHeader
        title="Library"
        description="Every document you're allowed to see, with its status and owner. Approved documents are the official versions."
      />
      <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label="Documents">
        <div className="flex flex-col gap-4 border-b p-4 md:px-6">
          <FilterTabs
            label="Status"
            value={status}
            onChange={setStatus}
            options={statusOptions}
            className="hidden lg:inline-flex lg:self-start"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <IconInput
                icon={SearchIcon}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search titles and text"
                aria-label="Search documents"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <div className="lg:hidden">
                <SimpleSelect
                  label="Filter by status"
                  value={status}
                  onChange={setStatus}
                  options={statusOptions.map((o) => ({ value: o.value, label: o.label }))}
                />
              </div>
              <SimpleSelect
                label="Filter by group"
                value={groupId}
                onChange={setGroupId}
                options={[
                  { value: "all", label: "All groups" },
                  ...user.groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </div>
          </div>
        </div>

        {docs.isPending ? (
          <ListSkeleton rows={6} />
        ) : docs.isError ? (
          <div className="p-4">
            <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
          </div>
        ) : docs.data.items.length === 0 ? (
          <EmptyState
            icon={LibraryIcon}
            title={filtered ? "No documents match" : "No documents yet"}
            description={
              filtered
                ? "Try another search, or clear the filters."
                : "Nothing has been shared with your groups yet."
            }
          />
        ) : (
          <ul className="divide-y" data-testid="document-list">
            {docs.data.items.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
