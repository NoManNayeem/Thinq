import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@/lib/api/client";
import { connectionsOf, filterGraph, initials, matches, neighbourhood, relationLabel } from "./graph";

const node = (
  id: string,
  kind: GraphNode["kind"],
  label = id,
  extra: Partial<GraphNode> = {},
): GraphNode => ({
  id,
  kind,
  label,
  degree: 1,
  ...extra,
});

const nodes = [
  node("d1", "document", "Travel Policy v2", { status: "approved", owner: "Alex Morgan" }),
  node("d2", "document", "Travel Policy v3", { status: "draft" }),
  node("p1", "person", "Alex Morgan"),
  node("e1", "entity", "per diem", { entity_type: "concept" }),
  node("e2", "entity", "orphan"),
];
const edges: GraphEdge[] = [
  { source: "d1", target: "d2", kind: "version", label: "next version" },
  { source: "d1", target: "p1", kind: "owned_by", label: "owned by" },
  { source: "d2", target: "e1", kind: "mentions", label: "mentions" },
];

describe("graph helpers", () => {
  it("filters by kind and drops dangling edges and floating topics", () => {
    const out = filterGraph({ nodes, edges }, { kinds: new Set(["document", "entity"]), query: "" });
    expect(out.nodes.map((n) => n.id)).toEqual(["d1", "d2", "e1"]);
    expect(out.edges.map((e) => e.kind)).toEqual(["version", "mentions"]);
  });

  it("matches on label, owner and topic type", () => {
    expect(matches(nodes[0], "alex")).toBe(true);
    expect(matches(nodes[3], "concept")).toBe(true);
    expect(matches(nodes[1], "")).toBe(false);
  });

  it("lists connections from the selected node's side", () => {
    const c = connectionsOf("d2", nodes, edges);
    expect(c.map((x) => [x.node.id, relationLabel(x)])).toEqual([
      ["d1", "Earlier version"],
      ["e1", "Mentions"],
    ]);
    expect(relationLabel(connectionsOf("p1", nodes, edges)[0])).toBe("Owns");
  });

  it("lists each connected thing once, by its most meaningful link", () => {
    const extra: GraphEdge[] = [...edges, { source: "p1", target: "d1", kind: "relation", label: "owns" }];
    const c = connectionsOf("d1", nodes, extra);
    expect(c.filter((x) => x.node.id === "p1").map((x) => x.edge.kind)).toEqual(["owned_by"]);
  });

  it("computes a neighbourhood", () => {
    expect(neighbourhood(null, edges)).toBeNull();
    expect([...(neighbourhood("d1", edges) ?? [])].sort()).toEqual(["d1", "d2", "p1"]);
  });

  it("makes initials", () => {
    expect(initials("Alex Morgan")).toBe("AM");
    expect(initials("Operations")).toBe("OP");
  });
});
