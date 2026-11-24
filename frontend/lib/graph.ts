import { FileTextIcon, type LucideIcon, SparklesIcon, UserRoundIcon, UsersRoundIcon } from "lucide-react";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@/lib/api/client";

export type NodeKind = GraphNode["kind"];
export type EdgeKind = GraphEdge["kind"];

export const KIND_META: Record<NodeKind, { label: string; plural: string; icon: LucideIcon }> = {
  document: { label: "Document", plural: "Documents", icon: FileTextIcon },
  person: { label: "Person", plural: "People", icon: UserRoundIcon },
  group: { label: "Group", plural: "Groups", icon: UsersRoundIcon },
  entity: { label: "Topic", plural: "Topics", icon: SparklesIcon },
};

export const KIND_ORDER: NodeKind[] = ["document", "person", "group", "entity"];

export const EDGE_META: Record<EdgeKind, { label: string; directed: boolean }> = {
  version: { label: "Next version", directed: true },
  references: { label: "Refers to", directed: true },
  owned_by: { label: "Owned by", directed: true },
  shared_with: { label: "Shared with", directed: true },
  mentions: { label: "Mentions", directed: true },
  relation: { label: "Related", directed: true },
};

export type GraphFilter = { kinds: ReadonlySet<NodeKind>; query: string };

/** Keep the chosen kinds; drop edges that lost an end. Search never hides nodes, it highlights. */
export function filterGraph(graph: Pick<KnowledgeGraph, "nodes" | "edges">, filter: GraphFilter) {
  const nodes = graph.nodes.filter((n) => filter.kinds.has(n.kind));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  // Topics only make sense attached to something: drop the ones left floating by a filter.
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const kept = nodes.filter((n) => n.kind !== "entity" || linked.has(n.id));
  return { nodes: kept, edges };
}

export function matches(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return [node.label, node.owner, node.group, node.entity_type]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

export type Connection = { node: GraphNode; edge: GraphEdge; direction: "out" | "in" };

export function connectionsOf(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]): Connection[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Connection[] = [];
  for (const edge of edges) {
    if (edge.source === nodeId) {
      const node = byId.get(edge.target);
      if (node) out.push({ node, edge, direction: "out" });
    } else if (edge.target === nodeId) {
      const node = byId.get(edge.source);
      if (node) out.push({ node, edge, direction: "in" });
    }
  }
  // One row per connected thing: when it's linked several ways (an owner who is also a topic
  // that "owns" the document), keep the most meaningful link.
  const priority: EdgeKind[] = ["version", "references", "owned_by", "shared_with", "mentions", "relation"];
  const best = new Map<string, Connection>();
  for (const c of out) {
    const seen = best.get(c.node.id);
    if (!seen || priority.indexOf(c.edge.kind) < priority.indexOf(seen.edge.kind)) best.set(c.node.id, c);
  }
  const rank = (c: Connection) => KIND_ORDER.indexOf(c.node.kind);
  return [...best.values()].sort((a, b) => rank(a) - rank(b) || a.node.label.localeCompare(b.node.label));
}

/** How a connection reads from the selected node's side. */
export function relationLabel(c: Connection): string {
  const { kind, label } = c.edge;
  if (c.direction === "out") return kind === "relation" ? label : EDGE_META[kind].label;
  switch (kind) {
    case "version":
      return "Earlier version";
    case "references":
      return "Referred to by";
    case "owned_by":
      return "Owns";
    case "shared_with":
      return "Has access to";
    case "mentions":
      return "Mentioned in";
    default:
      return label;
  }
}

export function neighbourhood(nodeId: string | null, edges: GraphEdge[]): Set<string> | null {
  if (!nodeId) return null;
  const set = new Set([nodeId]);
  for (const e of edges) {
    if (e.source === nodeId) set.add(e.target);
    if (e.target === nodeId) set.add(e.source);
  }
  return set;
}

export function radius(node: GraphNode): number {
  const boost = Math.min(node.degree, 8);
  switch (node.kind) {
    case "document":
      return 14 + boost;
    case "group":
      return 18;
    case "person":
      return 12;
    default:
      return 5 + Math.min(node.degree, 6);
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
}
