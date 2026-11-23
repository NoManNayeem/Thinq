"use client";

import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DatabaseIcon,
  GlobeIcon,
  type LucideIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { StatusDot } from "@/components/common/badges";
import { IconTile, Panel } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "destructive" | "muted";

function Row({
  name,
  icon,
  detail,
  tone,
  label,
}: {
  name: string;
  icon: LucideIcon;
  detail?: React.ReactNode;
  tone: Tone;
  label: string;
}) {
  return (
    <li
      className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6"
      data-testid={`component-${name.toLowerCase()}`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <IconTile icon={icon} />
        <div className="min-w-0">
          <div className="font-medium text-sm">{name}</div>
          {detail && <div className="truncate text-muted-foreground text-xs">{detail}</div>}
        </div>
      </div>
      <StatusDot tone={tone} label={label} pulse={tone === "success"} />
    </li>
  );
}

export function StatusScreen() {
  const health = useHealth();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const data = health.data;
  const apiUp = data?.reachable === true;
  const dbUp = apiUp && data.report.database.status === "up";
  const overall: { tone: Tone; title: string; body: string } = health.isPending
    ? { tone: "muted", title: "Checking…", body: "Contacting Thinq services." }
    : !apiUp
      ? {
          tone: "destructive",
          title: "API unreachable",
          body: "The web app is up, but it can't reach the Thinq API.",
        }
      : !dbUp
        ? {
            tone: "warning",
            title: "Degraded service",
            body: "The API is up, but the database isn't responding. Sign-in and data are unavailable.",
          }
        : {
            tone: "success",
            title: "All systems operational",
            body: "Every component is responding normally.",
          };

  return (
    <div className="min-h-svh bg-canvas">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 md:px-8">
          <Logo />
          <ButtonLink href="/" variant="ghost">
            <ArrowLeftIcon />
            Back to Thinq
          </ButtonLink>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">System status</h1>
          <p className="text-muted-foreground text-sm">
            Live health of the web app, API and database. Refreshes every 5 seconds.
          </p>
        </div>

        <div
          className={cn(
            "flex items-start gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6",
            overall.tone === "success" && "border-success/30",
            overall.tone === "warning" && "border-warning/40",
            overall.tone === "destructive" && "border-destructive/30",
          )}
          role="status"
          data-testid="overall-status"
          data-tone={overall.tone}
        >
          <IconTile
            icon={overall.tone === "success" ? CheckCircle2Icon : CircleAlertIcon}
            tone={overall.tone === "muted" ? "neutral" : overall.tone}
          />
          <div className="flex-1">
            <p className="font-semibold text-base">{overall.title}</p>
            <p className="text-muted-foreground text-sm">{overall.body}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => health.refetch()}
            aria-label="Check now"
            disabled={health.isFetching}
          >
            <RefreshCwIcon className={cn(health.isFetching && "animate-spin")} />
          </Button>
        </div>

        <Panel
          icon={ServerIcon}
          title="Components"
          description={
            health.dataUpdatedAt
              ? `Last checked ${relativeTime(new Date(health.dataUpdatedAt)).toLowerCase()}`
              : undefined
          }
        >
          {health.isPending ? (
            <div className="flex flex-col gap-4 p-6">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <ul className="divide-y">
              <Row
                name="Web"
                icon={GlobeIcon}
                detail="This page was served by the Thinq web app"
                tone="success"
                label="Operational"
              />
              <Row
                name="API"
                icon={ServerIcon}
                detail={
                  apiUp
                    ? `Version ${data.report.version} · ${data.report.environment}`
                    : `No response${data?.reachable === false ? ` (HTTP ${data.status})` : ""}`
                }
                tone={apiUp ? "success" : "destructive"}
                label={apiUp ? "Operational" : "Unreachable"}
              />
              <Row
                name="Database"
                icon={DatabaseIcon}
                detail={
                  !apiUp
                    ? "Unknown while the API is unreachable"
                    : dbUp
                      ? `PostgreSQL ${data.report.database.server_version} · ${data.report.database.latency_ms} ms · pgvector ${data.report.database.pgvector ? "enabled" : "missing"}`
                      : (data.report.database.error ?? "Not responding")
                }
                tone={!apiUp ? "muted" : dbUp ? "success" : "destructive"}
                label={!apiUp ? "Unknown" : dbUp ? "Operational" : "Down"}
              />
            </ul>
          )}
        </Panel>

        <StreamCheck />
      </main>
    </div>
  );
}

type StreamEvent = { n: number; atMs: number };

function StreamCheck() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const source = useRef<EventSource | null>(null);

  useEffect(() => () => source.current?.close(), []);

  const run = () => {
    source.current?.close();
    setEvents([]);
    setState("running");
    const started = performance.now();
    const es = new EventSource("/api/system/stream-test?count=5&interval_ms=400");
    source.current = es;
    es.addEventListener("tick", (e) => {
      const { n } = JSON.parse((e as MessageEvent<string>).data) as { n: number };
      setEvents((prev) => [...prev, { n, atMs: Math.round(performance.now() - started) }]);
    });
    es.addEventListener("done", () => {
      es.close();
      setState("done");
    });
    es.onerror = () => {
      es.close();
      setState((s) => (s === "done" ? s : "failed"));
    };
  };

  const spread = events.length > 1 ? (events.at(-1)?.atMs ?? 0) - (events[0]?.atMs ?? 0) : 0;
  const incremental = state === "done" && events.length >= 5 && spread >= 1000;

  return (
    <Panel
      icon={RadioTowerIcon}
      title="Streaming"
      description="Checks that events reach your browser one by one, not all at once."
      actions={
        <Button onClick={run} disabled={state === "running"} data-testid="run-stream-test">
          <RadioTowerIcon />
          {state === "idle" ? "Run check" : "Run again"}
        </Button>
      }
    >
      <div className="p-4 md:p-6">
        {state === "idle" ? (
          <p className="text-muted-foreground text-sm">Sends five events, 0.4 seconds apart.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <ol className="grid grid-cols-5 gap-2" aria-label="Received events">
              {Array.from({ length: 5 }, (_, i) => {
                const e = events[i];
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed five slots
                    key={i}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs",
                      e ? "border-foreground/20 bg-secondary" : "border-dashed text-muted-foreground",
                    )}
                    data-testid={e ? "stream-event" : undefined}
                  >
                    <span className="font-medium">#{i + 1}</span>
                    <span className="tabular">{e ? `${(e.atMs / 1000).toFixed(2)} s` : "…"}</span>
                  </li>
                );
              })}
            </ol>
            <p className="text-sm" data-testid="stream-result">
              {state === "running" && <span className="text-muted-foreground">Receiving…</span>}
              {state === "failed" && (
                <span className="text-destructive">The stream failed. Check that the API is reachable.</span>
              )}
              {state === "done" &&
                (incremental ? (
                  <span className="text-success">
                    Streaming works: events arrived over {(spread / 1000).toFixed(1)} seconds.
                  </span>
                ) : (
                  <span className="text-warning">
                    Events arrived together. A proxy may be buffering responses.
                  </span>
                ))}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
