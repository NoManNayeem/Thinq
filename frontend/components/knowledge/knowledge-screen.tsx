"use client";

import { ListIcon, NetworkIcon, RefreshCwIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FilterTabs } from "@/components/common/filter-tabs";
import { IconInput } from "@/components/common/inputs";
import { Page, PageHeader } from "@/components/common/page";
import { EmptyState, ErrorState } from "@/components/common/states";
import { StatusBadge } from "@/components/documents/status-badge";
import { useCurrentUser } from "@/components/shell/current-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounced } from "@/hooks/use-debounced";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { DocumentStatus, GraphNode } from "@/lib/api/client";
import { useKnowledgeGraph, useKnowledgeStatus, useSyncKnowledge } from "@/lib/api/queries";
import { filterGraph, KIND_META, KIND_ORDER, matches, type NodeKind } from "@/lib/graph";
import { cn } from "@/lib/utils";
import { GraphCanvas } from "./graph-canvas";
import { NodeDetails } from "./node-details";

type View = "graph" | "list";

const LAYER_LABEL = {
  off: null,
  ok: "Topics from the knowledge layer",
  indexing: "Knowledge layer is still indexing",
  unavailable: "Knowledge layer unavailable: showing documents only",
} as const;

export function KnowledgeScreen() {
  const me = useCurrentUser();
  const isAdmin = me.user.role === "admin";
  const graph = useKnowledgeGraph();
  const [view, setView] = useState<View>("graph");
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 150);
  const [kinds, setKinds] = useState<Set<NodeKind>>(new Set(KIND_ORDER));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1024px)");

  const data = graph.data;
  const counts = useMemo(() => {
    const c: Record<NodeKind, number> = { document: 0, person: 0, group: 0, entity: 0 };
    for (const n of data?.nodes ?? []) c[n.kind] += 1;
    return c;
  }, [data]);
  const visible = useMemo(
    () => (data ? filterGraph(data, { kinds, query }) : { nodes: [], edges: [] }),
    [data, kinds, query],
  );
  const highlighted = useMemo(() => {
    if (!query) return null;
    return new Set(visible.nodes.filter((n) => matches(n, query)).map((n) => n.id));
  }, [visible.nodes, query]);
  const selected = visible.nodes.find((n) => n.id === selectedId) ?? null;

  const toggleKind = (kind: NodeKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind) && next.size > 1) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const layer = data ? LAYER_LABEL[data.cognee] : null;
  const details = (
    <NodeDetails node={selected} nodes={visible.nodes} edges={visible.edges} onSelect={setSelectedId} />
  );

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Knowledge graph"
        description="How the documents you can access connect: versions, owners, groups and the topics they mention. Everything here follows your access, exactly like answers do."
        meta={
          data && (
            <>
              <Badge variant="outline" data-testid="graph-access">
                <ShieldCheckIcon aria-hidden />
                {data.answering_from.length ? `From: ${data.answering_from.join(", ")}` : "No groups yet"}
              </Badge>
              {layer && (
                <Badge variant={data.cognee === "ok" ? "info" : "outline"} data-testid="graph-layer">
                  {layer}
                </Badge>
              )}
            </>
          )
        }
        actions={isAdmin && data && data.cognee !== "off" ? <AdminSync /> : undefined}
      />

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label="Knowledge graph">
        <div className="flex flex-col gap-4 border-b p-4 md:flex-row md:items-center md:px-6">
          <div className="min-w-0 md:max-w-xs md:flex-1">
            <IconInput
              icon={SearchIcon}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a document, person or topic"
              aria-label="Find in the graph"
            />
          </div>
          <fieldset className="flex flex-wrap gap-2" aria-label="Show">
            {KIND_ORDER.filter((k) => counts[k] > 0).map((kind) => {
              const meta = KIND_META[kind];
              const on = kinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleKind(kind)}
                  className={cn(
                    "inline-flex h-12 items-center gap-2 rounded-lg border px-4 font-medium text-sm outline-none transition-colors md:h-10 md:pointer-coarse:h-12",
                    "focus-visible:ring-3 focus-visible:ring-ring/40",
                    on
                      ? "border-foreground/20 bg-secondary text-foreground"
                      : "border-dashed text-muted-foreground hover:text-foreground",
                  )}
                >
                  <meta.icon className="size-4" aria-hidden />
                  {meta.plural}
                  <span className="text-muted-foreground text-xs tabular">{counts[kind]}</span>
                </button>
              );
            })}
          </fieldset>
          <FilterTabs
            label="View"
            value={view}
            onChange={setView}
            className="md:ml-auto"
            options={[
              { value: "graph", label: "Graph", icon: NetworkIcon },
              { value: "list", label: "List", icon: ListIcon },
            ]}
          />
        </div>

        {graph.isPending ? (
          <div className="p-6">
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
        ) : graph.isError ? (
          <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
        ) : visible.nodes.length === 0 ? (
          <EmptyState
            icon={NetworkIcon}
            title="Nothing to map yet"
            description="Documents shared with your groups appear here, with their versions, owners and topics."
          />
        ) : view === "list" ? (
          <NodeList
            nodes={visible.nodes}
            query={query}
            onSelect={(id) => {
              setSelectedId(id);
              setView("graph");
            }}
          />
        ) : (
          <div className="grid lg:grid-cols-[1fr_22rem]">
            <div className="relative bg-canvas">
              <GraphCanvas
                nodes={visible.nodes}
                edges={visible.edges}
                selectedId={selectedId}
                highlighted={highlighted}
                onSelect={setSelectedId}
                className="h-[28rem] md:h-[36rem]"
              />
              <Legend hasTopics={kinds.has("entity") && counts.entity > 0} />
              {highlighted && (
                <p
                  className="absolute top-4 left-4 rounded-md border bg-card px-2 py-1 text-xs shadow-xs"
                  aria-live="polite"
                >
                  {highlighted.size} match{highlighted.size === 1 ? "" : "es"}
                </p>
              )}
            </div>
            {wide ? (
              <aside className="max-h-[36rem] overflow-y-auto border-l" aria-label="Details">
                {details}
              </aside>
            ) : (
              <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
                <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
                  <SheetTitle className="sr-only">{selected?.label ?? "Details"}</SheetTitle>
                  {details}
                </SheetContent>
              </Sheet>
            )}
          </div>
        )}
      </section>
    </Page>
  );
}

function Legend({ hasTopics }: { hasTopics: boolean }) {
  const items: { label: string; swatch: React.ReactNode }[] = [
    { label: "Approved", swatch: <Dot color="var(--success)" /> },
    { label: "Draft", swatch: <Dot color="var(--warning)" /> },
    { label: "Reference", swatch: <Dot color="var(--info)" /> },
    { label: "Outdated / unknown", swatch: <Dot color="var(--muted-foreground)" dashed /> },
    {
      label: "Group",
      swatch: <span className="size-3 rounded-sm border-2 border-primary bg-primary-subtle" />,
    },
    { label: "Next version", swatch: <span className="h-0.5 w-4 bg-primary" /> },
  ];
  if (hasTopics)
    items.push({ label: "Topic", swatch: <span className="size-2 rounded-full bg-muted-foreground/60" /> });
  return (
    <ul
      className="pointer-events-none absolute bottom-4 left-4 hidden flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-card/90 px-4 py-2 text-muted-foreground text-xs shadow-xs backdrop-blur sm:flex sm:max-w-md"
      aria-label="Legend"
    >
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Dot({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      className={cn("size-3 rounded-full border-2 bg-card", dashed && "border-dashed")}
      style={{ borderColor: color }}
    />
  );
}

function NodeList({
  nodes,
  query,
  onSelect,
}: {
  nodes: GraphNode[];
  query: string;
  onSelect: (id: string) => void;
}) {
  const rows = (query ? nodes.filter((n) => matches(n, query)) : nodes)
    .slice()
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.degree - a.degree);
  return (
    <ul className="divide-y" data-testid="graph-list">
      {rows.map((n) => {
        const Icon = KIND_META[n.kind].icon;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              className="flex min-h-12 w-full items-center gap-4 px-4 py-2 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset md:px-6"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{n.label}</span>
                <span className="text-muted-foreground text-xs">
                  {n.kind === "entity" && n.entity_type
                    ? `Topic · ${n.entity_type}`
                    : KIND_META[n.kind].label}
                  {n.owner ? ` · ${n.owner}` : ""}
                </span>
              </span>
              {n.kind === "document" && n.status && <StatusBadge status={n.status as DocumentStatus} />}
              <span className="w-24 text-right text-muted-foreground text-xs tabular">
                {n.degree} link{n.degree === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AdminSync() {
  const status = useKnowledgeStatus();
  const sync = useSyncKnowledge();
  const busy = status.data?.syncing || sync.isPending;
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: () => toast.success("Sync started. New and changed documents will appear shortly."),
          onError: (e) => toast.error(e.message),
        })
      }
    >
      <RefreshCwIcon className={cn(busy && "animate-spin")} aria-hidden />
      {busy ? "Syncing…" : "Sync now"}
      {status.data && status.data.pending + status.data.failed > 0 && (
        <span className="text-muted-foreground text-xs tabular">
          {status.data.pending + status.data.failed} waiting
        </span>
      )}
    </Button>
  );
}
