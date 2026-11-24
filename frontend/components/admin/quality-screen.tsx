"use client";

import {
  FileSearchIcon,
  GaugeIcon,
  MessageCircleQuestionIcon,
  SearchCodeIcon,
  TableIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FilterTabs } from "@/components/common/filter-tabs";
import { Page, PageHeader, Panel } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { ErrorState, ListSkeleton } from "@/components/common/states";
import { StatusBadge } from "@/components/documents/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type DocumentStatus, errorMessage, type Inspection, type Quality } from "@/lib/api/client";
import { useInspect, useQuality, useUsers } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

type Period = "7" | "30" | "90";

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function compact(n: number) {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString();
}

export function QualityScreen() {
  const [period, setPeriod] = useState<Period>("30");
  const quality = useQuality(Number(period));
  const q = quality.data;
  return (
    <Page>
      <PageHeader
        title="Answer quality"
        description="Live figures from answers and feedback, and a tool to see exactly what any person's question would retrieve."
      />
      <FilterTabs
        label="Period"
        value={period}
        onChange={setPeriod}
        className="self-start"
        options={[
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
        ]}
      />
      {quality.isPending ? (
        <ListSkeleton />
      ) : quality.isError ? (
        <ErrorState error={quality.error} onRetry={() => quality.refetch()} />
      ) : (
        q && <Dashboard q={q} />
      )}
      <Inspector />
    </Page>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs" data-testid="stat">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-semibold text-2xl tabular">{value}</span>
      {note && <span className="text-muted-foreground text-xs">{note}</span>}
    </div>
  );
}

function Dashboard({ q }: { q: Quality }) {
  const rated = q.helpful + q.not_helpful;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="quality-stats">
        <Stat
          label="Questions"
          value={compact(q.questions)}
          note={`${q.errors} failed · ${q.stopped} stopped`}
        />
        <Stat
          label="Answered with sources"
          value={pct(q.answered, q.questions)}
          note={`${q.answered} answers`}
        />
        <Stat
          label="Couldn't answer"
          value={pct(q.no_source, q.questions)}
          note={`${q.no_source} questions`}
        />
        <Stat label="Rated helpful" value={pct(q.helpful, rated)} note={`${rated} rated`} />
        <Stat
          label="Open reports"
          value={compact(q.open_reports)}
          note={
            q.median_hours_to_resolve !== null
              ? `Median ${q.median_hours_to_resolve} h to resolve`
              : `${q.resolved_reports} resolved`
          }
        />
        <Stat
          label="Model tokens"
          value={compact(q.input_tokens + q.output_tokens)}
          note={`${compact(q.output_tokens)} written`}
        />
        <Stat
          label="Estimated model cost"
          value={q.cost_usd === null ? "—" : `$${q.cost_usd.toFixed(q.cost_usd < 1 ? 4 : 2)}`}
          note={q.cost_usd === 0 ? "Local model" : "From the bundled price list"}
        />
        <Stat label="Resolved reports" value={compact(q.resolved_reports)} />
      </div>
      <QuestionsChart days={q.by_day} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          icon={MessageCircleQuestionIcon}
          title="Questions Thinq couldn't answer"
          description="Gaps in the documentation. Shown without who asked."
        >
          {q.top_unanswered.length === 0 ? (
            <p className="px-4 py-4 text-muted-foreground text-sm md:px-6">None in this period.</p>
          ) : (
            <ol className="divide-y" data-testid="unanswered">
              {q.top_unanswered.map((u) => (
                <li
                  key={u.question}
                  className="flex items-center justify-between gap-4 px-4 py-2 text-sm md:px-6"
                >
                  <span className="min-w-0">{u.question}</span>
                  <span className="shrink-0 text-muted-foreground text-xs tabular">×{u.times}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel icon={FileSearchIcon} title="Most cited documents" description="Cited first in an answer.">
          {q.top_cited.length === 0 ? (
            <p className="px-4 py-4 text-muted-foreground text-sm md:px-6">None in this period.</p>
          ) : (
            <ol className="divide-y">
              {q.top_cited.map((c) => (
                <li
                  key={String(c.title)}
                  className="flex items-center justify-between gap-4 px-4 py-2 text-sm md:px-6"
                >
                  <span className="min-w-0">{String(c.title)}</span>
                  <span className="shrink-0 text-muted-foreground text-xs tabular">×{String(c.times)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}

type Day = { day: string; questions: number; no_source: number };

/** One series (questions per day), so no legend; per-bar hover and a table view. */
function QuestionsChart({ days }: { days: Record<string, unknown>[] }) {
  const rows = days as unknown as Day[];
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.questions));
  const ticks = useMemo(() => {
    const step = max <= 4 ? 1 : Math.ceil(max / 4);
    return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  }, [max]);
  const top = ticks[ticks.length - 1] || 1;
  const width = 640;
  const height = 200;
  const pad = { l: 32, r: 8, t: 8, b: 24 };
  const band = (width - pad.l - pad.r) / Math.max(rows.length, 1);
  const barW = Math.min(24, band - 2);
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / top);
  return (
    <Panel
      icon={GaugeIcon}
      title="Questions per day"
      actions={
        <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          <TableIcon />
          {table ? "Show chart" : "Show as table"}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-muted-foreground text-sm md:px-6">No questions in this period.</p>
      ) : table ? (
        <table className="w-full text-sm" data-testid="questions-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium md:px-6">Day</th>
              <th className="px-4 py-2 text-right font-medium">Questions</th>
              <th className="px-4 py-2 text-right font-medium md:px-6">Couldn't answer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-b last:border-0">
                <td className="px-4 py-2 md:px-6">{r.day}</td>
                <td className="px-4 py-2 text-right tabular">{r.questions}</td>
                <td className="px-4 py-2 text-right tabular md:px-6">{r.no_source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative px-4 py-4 md:px-6">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-52 w-full"
            role="img"
            aria-label="Questions per day"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={pad.l}
                  x2={width - pad.r}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={pad.l - 8}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="central"
                  className="fill-muted-foreground text-xs"
                >
                  {t}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x = pad.l + band * i + (band - barW) / 2;
              const h = y(0) - y(r.questions);
              const radius = Math.min(4, h);
              return (
                <g key={r.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={height - pad.t - pad.b}
                    fill="transparent"
                  />
                  {h > 0 && (
                    <path
                      d={`M${x},${y(0)} V${y(r.questions) + radius} Q${x},${y(r.questions)} ${x + radius},${y(r.questions)} H${x + barW - radius} Q${x + barW},${y(r.questions)} ${x + barW},${y(r.questions) + radius} V${y(0)} Z`}
                      fill="var(--chart-bar)"
                      opacity={hover === null || hover === i ? 1 : 0.4}
                    />
                  )}
                  {(i === 0 || i === rows.length - 1 || rows.length <= 8) && (
                    <text
                      x={x + barW / 2}
                      y={height - 8}
                      textAnchor="middle"
                      className="fill-muted-foreground text-xs"
                    >
                      {r.day.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
            />
          </svg>
          {hover !== null && rows[hover] && (
            <div
              className="pointer-events-none absolute top-4 rounded-md border bg-popover px-2 py-1 text-xs shadow-md"
              style={{ left: `calc(${((pad.l + band * hover + band / 2) / width) * 100}% )` }}
              role="status"
            >
              <span className="font-medium">{rows[hover].day}</span> · {rows[hover].questions} questions ·{" "}
              {rows[hover].no_source} unanswered
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

const DECISION: Record<string, { label: string; variant: "success" | "outline" | "warning" | "default" }> = {
  cited: { label: "Cited", variant: "success" },
  ranked_lower: { label: "Ranked lower", variant: "outline" },
  below_threshold: { label: "Not relevant enough", variant: "default" },
  outdated_excluded: { label: "Outdated: excluded", variant: "warning" },
};

function Inspector() {
  const users = useUsers({ limit: 200, status: "active" });
  const inspect = useInspect();
  const [userId, setUserId] = useState("");
  const [question, setQuestion] = useState("");
  const options = [
    { value: "", label: "Choose a person" },
    ...(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.name })),
  ];
  return (
    <Panel
      icon={SearchCodeIcon}
      title="Retrieval inspector"
      description="Run a question as someone else and see what was eligible, what was cited, and why. Nothing is answered or saved."
    >
      <form
        className="flex flex-col gap-4 p-4 md:flex-row md:items-end md:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!userId || !question.trim()) return;
          inspect.mutate(
            { user_id: userId, question: question.trim() },
            { onError: (err) => toast.error(errorMessage(err)) },
          );
        }}
      >
        <Field className="md:w-56">
          <FieldLabel htmlFor="inspect-user">Ask as</FieldLabel>
          <SimpleSelect
            id="inspect-user"
            label="Person"
            value={userId}
            onChange={setUserId}
            options={options}
            className="md:w-full"
          />
        </Field>
        <Field className="flex-1">
          <FieldLabel htmlFor="inspect-question">Question</FieldLabel>
          <Input
            id="inspect-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What's the current onboarding checklist?"
          />
        </Field>
        <Button type="submit" variant="outline" disabled={!userId || !question.trim() || inspect.isPending}>
          {inspect.isPending && <Spinner />}
          Inspect
        </Button>
      </form>
      {inspect.data && <InspectResult r={inspect.data} />}
    </Panel>
  );
}

function InspectResult({ r }: { r: Inspection }) {
  return (
    <div className="flex flex-col gap-4 border-t p-4 md:p-6" data-testid="inspect-result">
      <p className="text-sm">
        As <span className="font-medium">{r.as_user}</span> ({r.groups.join(", ")}): searched {r.searched}{" "}
        documents
        {r.excluded.unregistered ? `, skipped ${r.excluded.unregistered} unregistered` : ""}
        {r.excluded.missing ? `, ${r.excluded.missing} missing from the source` : ""}. Semantic search:{" "}
        {r.semantic}.
      </p>
      {r.hidden_from_you > 0 && (
        <p className="text-muted-foreground text-sm">
          {r.hidden_from_you} matching document{r.hidden_from_you === 1 ? "" : "s"} you can't see yourself, so
          not named here.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="px-4 py-2 font-medium">Document</th>
              <th className="px-4 py-2 font-medium">Decision</th>
              <th className="px-4 py-2 text-right font-medium">Relevance</th>
              <th className="px-4 py-2 text-right font-medium">Trust</th>
            </tr>
          </thead>
          <tbody>
            {r.candidates.map((c) => (
              <tr key={c.title} className="border-t">
                <td className="px-4 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    {c.rank ? <span className="text-muted-foreground tabular">[{c.rank}]</span> : null}
                    {c.title}
                    <StatusBadge status={c.status as DocumentStatus} />
                  </span>
                </td>
                <td className="px-4 py-2">
                  <Badge variant={DECISION[c.decision]?.variant ?? "outline"}>
                    {DECISION[c.decision]?.label ?? c.decision}
                  </Badge>
                </td>
                <td className={cn("px-4 py-2 text-right tabular")}>
                  {Math.round(c.relevance * 100)}%
                  {c.semantic !== null && c.semantic !== undefined && (
                    <span className="block text-muted-foreground text-xs">
                      words {Math.round((c.lexical ?? 0) * 100)}% · meaning {Math.round(c.semantic * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular">×{c.trust_weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.notices.length > 0 && (
        <ul className="flex flex-col gap-1 text-muted-foreground text-sm">
          {r.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {r.owner_hint && (
        <p className="text-muted-foreground text-sm">
          Owner hint: {r.owner_hint.topic} — {r.owner_hint.owner} (from {r.owner_hint.title})
        </p>
      )}
    </div>
  );
}
