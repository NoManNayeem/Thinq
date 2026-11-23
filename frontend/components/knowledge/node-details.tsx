"use client";

import { ArrowUpRightIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import type { Route } from "next";
import { StatusBadge } from "@/components/documents/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import type { DocumentStatus, GraphEdge, GraphNode } from "@/lib/api/client";
import { STATUS } from "@/lib/documents";
import { connectionsOf, KIND_META, relationLabel } from "@/lib/graph";
import { cn } from "@/lib/utils";

export function NodeDetails({
  node,
  nodes,
  edges,
  onSelect,
}: {
  node: GraphNode | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect: (id: string | null) => void;
}) {
  if (!node) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <MousePointerClickIcon className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-medium text-sm">Select something to see how it connects</p>
        <p className="text-muted-foreground text-sm">
          Click a document, person or group. Drag to rearrange, scroll or pinch to zoom.
        </p>
      </div>
    );
  }
  const meta = KIND_META[node.kind];
  const connections = connectionsOf(node.id, nodes, edges);
  const status = node.status as DocumentStatus | undefined;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="node-details">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            node.kind === "group" ? "bg-primary-subtle text-primary" : "bg-secondary text-foreground",
          )}
          aria-hidden
        >
          <meta.icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-muted-foreground text-xs">
            {node.kind === "entity" && node.entity_type ? `Topic · ${node.entity_type}` : meta.label}
          </p>
          <h2 className="break-words font-semibold text-base">{node.label}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close details" onClick={() => onSelect(null)}>
          <XIcon aria-hidden />
        </Button>
      </div>

      {node.kind === "document" && status && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={status} />
            {node.group && <Badge variant="outline">{node.group}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">{STATUS[status]?.meaning}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Owner</dt>
            <dd>{node.owner ?? "Not recorded"}</dd>
            <dt className="text-muted-foreground">Last reviewed</dt>
            <dd>{node.last_reviewed ?? "Never"}</dd>
          </dl>
          {node.document_id && (
            <ButtonLink href={`/library/${node.document_id}` as Route} className="w-full">
              Open document
              <ArrowUpRightIcon aria-hidden />
            </ButtonLink>
          )}
        </div>
      )}
      {node.kind === "entity" && node.description && (
        <p className="text-muted-foreground text-sm">{node.description}</p>
      )}

      <section className="flex flex-col gap-2" aria-label="Connections">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Connections <span className="tabular">({connections.length})</span>
        </h3>
        {connections.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing linked to this yet.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {connections.map((c) => {
              const Icon = KIND_META[c.node.kind].icon;
              return (
                <li key={`${c.edge.source}-${c.edge.target}-${c.edge.kind}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.node.id)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/40 md:min-h-10"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{c.node.label}</span>
                      <span className="text-muted-foreground text-xs">{relationLabel(c)}</span>
                    </span>
                    {c.node.kind === "document" && c.node.status && (
                      <StatusBadge status={c.node.status as DocumentStatus} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
