"use client";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity, zoomTransform } from "d3-zoom";
import { MaximizeIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GraphEdge, GraphNode } from "@/lib/api/client";
import { STATUS } from "@/lib/documents";
import { initials, KIND_META, neighbourhood, radius } from "@/lib/graph";
import { cn } from "@/lib/utils";

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { edge: GraphEdge };

const LINK_DISTANCE: Record<GraphEdge["kind"], number> = {
  version: 130,
  references: 140,
  owned_by: 110,
  shared_with: 150,
  mentions: 70,
  relation: 60,
};

/** Status → colour token (fill uses a tint of the same colour). */
const STATUS_TONE: Record<string, string> = {
  approved: "var(--success)",
  draft: "var(--warning)",
  reference: "var(--info)",
  outdated: "var(--muted-foreground)",
  unknown: "var(--muted-foreground)",
};

function tone(node: GraphNode): string {
  if (node.kind === "document") return STATUS_TONE[node.status ?? "unknown"] ?? STATUS_TONE.unknown;
  if (node.kind === "group") return "var(--primary)";
  if (node.kind === "person") return "var(--foreground)";
  return "var(--muted-foreground)";
}

function nodeDescription(node: GraphNode): string {
  const kind = KIND_META[node.kind].label;
  const status =
    node.kind === "document" && node.status ? `, ${STATUS[node.status as keyof typeof STATUS]?.label}` : "";
  return `${kind}: ${node.label}${status}. ${node.degree} connection${node.degree === 1 ? "" : "s"}.`;
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  highlighted,
  onSelect,
  className,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  /** Search matches: drawn emphasised, everything else dimmed. */
  highlighted: Set<string> | null;
  onSelect: (id: string | null) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef<Map<string, SimNode>>(new Map());
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [, setFrame] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const fitView = useCallback(
    (animate = true) => {
      const svg = svgRef.current;
      const behaviour = zoomRef.current;
      const points = [...simNodes.current.values()];
      if (!svg || !behaviour || points.length === 0) return;
      // Read the live size and transform, never a value captured by an older render.
      const box = svg.getBoundingClientRect();
      const size = { width: box.width || 800, height: box.height || 560 };
      const xs = points.map((p) => p.x ?? 0);
      const ys = points.map((p) => p.y ?? 0);
      const pad = 72;
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const k = Math.min(
        2,
        (size.width - pad * 2) / Math.max(maxX - minX, 1),
        (size.height - pad * 2) / Math.max(maxY - minY, 1),
      );
      const next = zoomIdentity
        .translate(size.width / 2, size.height / 2 - 24) // keep clear of the legend
        .scale(Math.max(0.2, k))
        .translate(-(minX + maxX) / 2, -(minY + maxY - 24) / 2); // labels hang below nodes
      const target = select(svg);
      if (animate && !reduceMotion) {
        // A short eased step without pulling in d3-transition.
        const start = zoomTransform(svg);
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / 360);
          const e = 1 - (1 - t) ** 3;
          behaviour.transform(
            target,
            zoomIdentity
              .translate(start.x + (next.x - start.x) * e, start.y + (next.y - start.y) * e)
              .scale(start.k + (next.k - start.k) * e),
          );
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      } else {
        behaviour.transform(target, next);
      }
    },
    [reduceMotion],
  );

  // Pan and zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((event: Event) => !(event.target as Element).closest?.("[data-node]") || event.type === "wheel")
      .on("zoom", (event: { transform: ZoomTransform }) => setTransform(event.transform));
    zoomRef.current = behaviour;
    select(svg).call(behaviour).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  // Layout. Keeps positions of nodes that survive a filter change, so the picture doesn't jump.
  const fitOnSettle = useRef(true);
  useEffect(() => {
    const previous = simNodes.current;
    const next = new Map<string, SimNode>();
    nodes.forEach((n, i) => {
      const old = previous.get(n.id);
      const angle = i * 2.399963; // golden angle: an even first spread
      const r = 24 * Math.sqrt(i + 1);
      next.set(n.id, { ...n, x: old?.x ?? Math.cos(angle) * r, y: old?.y ?? Math.sin(angle) * r });
    });
    simNodes.current = next;
    const links: SimLink[] = edges.map((edge) => ({ source: edge.source, target: edge.target, edge }));
    const sim = forceSimulation<SimNode, SimLink>([...next.values()])
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => LINK_DISTANCE[l.edge.kind])
          .strength((l) => (l.edge.kind === "shared_with" ? 0.15 : 0.5)),
      )
      .force(
        "charge",
        forceManyBody<SimNode>().strength((d) => (d.kind === "entity" ? -60 : -260 - d.degree * 12)),
      )
      .force(
        "collide",
        forceCollide<SimNode>((d) => radius(d) + (d.kind === "entity" ? 4 : 30)).strength(0.9),
      )
      .force("x", forceX<SimNode>(0).strength(0.05))
      .force("y", forceY<SimNode>(0).strength(0.05));
    simRef.current = sim;

    if (reduceMotion) {
      sim.stop();
      sim.tick(320);
      setFrame((f) => f + 1);
      requestAnimationFrame(() => fitView(false));
    } else {
      let queued = false;
      sim.on("tick", () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          setFrame((f) => f + 1);
        });
      });
      sim.on("end", () => {
        if (fitOnSettle.current) {
          fitOnSettle.current = false;
          fitView();
        }
      });
      // Fit early too, so the first view isn't empty while the layout settles.
      const early = window.setTimeout(() => fitOnSettle.current && fitView(false), 450);
      return () => {
        window.clearTimeout(early);
        sim.stop();
      };
    }
    return () => {
      sim.stop();
    };
  }, [nodes, edges, reduceMotion, fitView]);

  // Dragging a node pins it while held, then lets it settle.
  const drag = useRef<{ id: string; pointer: number } | null>(null);
  const toGraph = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const [x, y] = transform.invert([clientX - rect.left, clientY - rect.top]);
    return { x, y };
  };
  const onPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId };
    const n = simNodes.current.get(id);
    if (n) {
      n.fx = n.x;
      n.fy = n.y;
    }
    if (!reduceMotion) simRef.current?.alphaTarget(0.2).restart();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    const n = simNodes.current.get(drag.current.id);
    if (!n) return;
    const p = toGraph(e.clientX, e.clientY);
    n.fx = p.x;
    n.fy = p.y;
    if (reduceMotion) {
      n.x = p.x;
      n.y = p.y;
      setFrame((f) => f + 1);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    const n = simNodes.current.get(drag.current.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    drag.current = null;
    simRef.current?.alphaTarget(0);
  };

  const focusSet = useMemo(() => neighbourhood(hoverId ?? selectedId, edges), [hoverId, selectedId, edges]);
  const dimmed = (id: string) => (focusSet ? !focusSet.has(id) : highlighted ? !highlighted.has(id) : false);
  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) zoomRef.current.scaleBy(select(svg), factor);
  };
  const showEntityLabels = transform.k > 1.3;
  // Relation captions only while pointing at a topic: shown for a whole neighbourhood they pile up.
  const hoveredTopic = hoverId !== null && simNodes.current.get(hoverId)?.kind === "entity";
  const positioned = [...simNodes.current.values()];
  const byId = simNodes.current;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG canvas can't be a fieldset */}
      <svg
        ref={svgRef}
        className="size-full touch-none select-none"
        role="group"
        aria-label="Knowledge graph. Use Tab to move between documents, people and groups, and Enter to see details."
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onSelect(null);
        }}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
          <marker
            id="graph-arrow-version"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary)" />
          </marker>
        </defs>
        <g transform={transform.toString()}>
          <g aria-hidden>
            {edges.map((edge) => {
              const s = byId.get(edge.source);
              const t = byId.get(edge.target);
              if (!s || !t || s.x === undefined || t.x === undefined) return null;
              const dx = (t.x ?? 0) - (s.x ?? 0);
              const dy = (t.y ?? 0) - (s.y ?? 0);
              const len = Math.hypot(dx, dy) || 1;
              const rs = radius(s) + 2;
              const rt = radius(t) + 4;
              const x1 = (s.x ?? 0) + (dx / len) * rs;
              const y1 = (s.y ?? 0) + (dy / len) * rs;
              const x2 = (t.x ?? 0) - (dx / len) * rt;
              const y2 = (t.y ?? 0) - (dy / len) * rt;
              const active = focusSet?.has(edge.source) && focusSet?.has(edge.target);
              const faded = (focusSet && !active) || dimmed(edge.source) || dimmed(edge.target);
              const isVersion = edge.kind === "version";
              const quiet =
                edge.kind === "mentions" || edge.kind === "relation" || edge.kind === "shared_with";
              return (
                <g
                  key={`${edge.source}-${edge.target}-${edge.kind}`}
                  className="transition-opacity duration-200"
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isVersion ? "var(--primary)" : "var(--muted-foreground)"}
                    strokeOpacity={faded ? 0.08 : active ? 0.9 : quiet ? 0.28 : 0.5}
                    strokeWidth={isVersion ? 2 : active ? 1.6 : 1}
                    strokeDasharray={edge.kind === "shared_with" ? "3 4" : undefined}
                    markerEnd={
                      edge.kind === "mentions" || edge.kind === "shared_with"
                        ? undefined
                        : isVersion
                          ? "url(#graph-arrow-version)"
                          : "url(#graph-arrow)"
                    }
                  />
                  {edge.kind === "relation" &&
                    hoveredTopic &&
                    (hoverId === edge.source || hoverId === edge.target) && (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 4}
                        textAnchor="middle"
                        className="fill-muted-foreground text-xs"
                        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4 }}
                      >
                        {edge.label}
                      </text>
                    )}
                </g>
              );
            })}
          </g>
          <g>
            {positioned.map((n) => {
              const r = radius(n);
              const color = tone(n);
              const selected = n.id === selectedId;
              const faded = dimmed(n.id);
              const emphasised = highlighted?.has(n.id);
              const showLabel =
                n.kind !== "entity" || showEntityLabels || selected || hoverId === n.id || emphasised;
              const outdated = n.kind === "document" && n.status === "outdated";
              const focusable = n.kind !== "entity";
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG has no button element; role + key handling below
                <g
                  key={n.id}
                  data-node={n.kind}
                  data-testid="graph-node"
                  data-label={n.label}
                  transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                  role="button"
                  tabIndex={focusable ? 0 : -1}
                  aria-label={nodeDescription(n)}
                  aria-pressed={selected}
                  className={cn(
                    "cursor-pointer outline-none transition-opacity duration-200",
                    faded ? "opacity-20" : "opacity-100",
                  )}
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerEnter={() => setHoverId(n.id)}
                  onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                  onFocus={() => setHoverId(n.id)}
                  onBlur={() => setHoverId((h) => (h === n.id ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(selected ? null : n.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(n.id);
                    }
                  }}
                >
                  {/* Larger invisible hit area: at least 48 px across for touch. */}
                  <circle r={Math.max(r, 24)} fill="transparent" />
                  {(selected || emphasised) && (
                    <circle r={r + 6} fill="none" stroke="var(--primary)" strokeWidth={selected ? 3 : 2} />
                  )}
                  <circle
                    r={r + 10}
                    className="graph-focus-ring"
                    fill="none"
                    stroke="var(--ring)"
                    strokeWidth={3}
                  />
                  {n.kind === "group" ? (
                    <rect
                      x={-r}
                      y={-r}
                      width={r * 2}
                      height={r * 2}
                      rx={8}
                      fill="var(--primary-subtle)"
                      stroke={color}
                      strokeWidth={2}
                    />
                  ) : (
                    <circle
                      r={r}
                      fill={n.kind === "entity" ? color : "var(--card)"}
                      fillOpacity={n.kind === "entity" ? 0.55 : 1}
                      stroke={color}
                      strokeWidth={n.kind === "entity" ? 0 : 2.5}
                      strokeDasharray={outdated ? "4 3" : undefined}
                    />
                  )}
                  {n.kind === "document" && (
                    <circle r={r - 5} fill={color} fillOpacity={outdated ? 0.08 : 0.16} />
                  )}
                  {(n.kind === "person" || n.kind === "group") && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={cn(
                        "font-medium text-xs",
                        n.kind === "group" ? "fill-primary" : "fill-foreground",
                      )}
                    >
                      {initials(n.label)}
                    </text>
                  )}
                  {showLabel && (
                    <text
                      y={r + 16}
                      textAnchor="middle"
                      className={cn(
                        "text-xs",
                        n.kind === "entity" ? "fill-muted-foreground" : "fill-foreground font-medium",
                        outdated && "fill-muted-foreground",
                      )}
                      style={{
                        paintOrder: "stroke",
                        stroke: "var(--card)",
                        strokeWidth: 4,
                        strokeLinejoin: "round",
                      }}
                    >
                      {n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="absolute top-4 right-4 flex flex-col gap-1 rounded-lg border bg-card p-1 shadow-xs">
        <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.3)}>
          <PlusIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
          <MinusIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Fit to screen" onClick={() => fitView()}>
          <MaximizeIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}
