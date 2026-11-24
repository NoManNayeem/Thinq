"use client";

import { ArrowUpRightIcon, ChevronDownIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { GroupChip } from "@/components/common/badges";
import { StatusBadge } from "@/components/documents/status-badge";
import type { ChatSource } from "@/lib/api/client";
import { STATUS } from "@/lib/documents";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function sourceAnchor(messageId: string, n: number) {
  return `source-${messageId}-${n}`;
}

const STATUS_DOT: Record<string, string> = {
  approved: "bg-success",
  draft: "bg-warning",
  reference: "bg-info",
  outdated: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
};

/** Excerpts are small: headings become bold lines, tables stay tables but compact. No raw HTML. */
const excerpt: Components = {
  h1: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h2: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h3: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h4: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-4">{children}</ol>,
  strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
  a: ({ children }) => <span className="underline underline-offset-4">{children}</span>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-secondary px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
  code: ({ children }) => <code className="rounded-sm bg-muted px-1 font-mono text-xs">{children}</code>,
  img: () => null,
};

/**
 * The collapsed form names the top source and its status, so every answer shows its source and
 * status without opening anything; one dot per source shows the rest at a glance.
 */
export function SourcesToggle({
  sources,
  open,
  onToggle,
  controls,
}: {
  sources: ChatSource[];
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  if (sources.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      data-testid="sources-toggle"
      className={cn(
        "inline-flex h-12 min-w-0 max-w-full items-center gap-2 rounded-full border px-4 font-medium text-sm outline-none transition-colors md:h-8 md:px-3 md:pointer-coarse:h-12",
        "hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/40",
        open ? "bg-secondary text-foreground" : "bg-card text-muted-foreground",
      )}
    >
      <span className="flex gap-1" aria-hidden>
        {sources.map((s) => (
          <span key={s.n} className={cn("size-2 rounded-full", STATUS_DOT[s.status] ?? STATUS_DOT.unknown)} />
        ))}
      </span>
      <span className="min-w-0 truncate" data-testid="top-source">
        <span className="text-foreground">{sources[0].title}</span> ·{" "}
        {STATUS[sources[0].status]?.label ?? sources[0].status}
      </span>
      {sources.length > 1 && <span className="shrink-0">+{sources.length - 1} more</span>}
      <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
}

/** The opened form: compact rows; each row's excerpt opens on request. */
export function SourcesPanel({
  id,
  messageId,
  sources,
  focus,
  summary,
  children,
}: {
  id: string;
  messageId: string;
  sources: ChatSource[];
  /** A source picked from an inline citation: opened and scrolled into view. */
  focus: number | null;
  summary?: string;
  children?: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus === null) return;
    const row = panel.current?.querySelector<HTMLDetailsElement>(
      `#${CSS.escape(sourceAnchor(messageId, focus))}`,
    );
    if (row) {
      row.open = true;
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row.querySelector("summary")?.focus({ preventScroll: true });
    }
  }, [focus, messageId]);

  return (
    <section
      ref={panel}
      id={id}
      aria-label="Sources"
      className="overflow-hidden rounded-xl border bg-card"
      data-testid="answer-sources"
    >
      <ol className="divide-y">
        {sources.map((s) => (
          <li key={s.n}>
            <details
              id={sourceAnchor(messageId, s.n)}
              className="group/source scroll-mt-24"
              data-testid="source-card"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 outline-none hover:bg-secondary/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary font-semibold text-xs tabular">
                  <span className="sr-only">Source </span>
                  {s.n}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="truncate font-medium text-sm">{s.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={s.status} />
                    {s.access_group && (
                      <GroupChip group={{ name: s.access_group, is_system: s.access_group_is_system }} />
                    )}
                  </span>
                </span>
                <ChevronDownIcon
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open/source:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="flex flex-col gap-4 bg-canvas px-4 pt-2 pb-4 sm:pl-13">
                <div
                  className="flex flex-col gap-2 text-muted-foreground text-sm"
                  data-testid="source-excerpt"
                >
                  <Markdown remarkPlugins={[remarkGfm]} components={excerpt} skipHtml>
                    {s.excerpt}
                  </Markdown>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
                  <span>
                    {s.owner_name ?? "No owner"} ·{" "}
                    {s.last_reviewed
                      ? `Reviewed ${dateTime(s.last_reviewed).replace(/, \d\d:\d\d$/, "")}`
                      : "Never reviewed"}
                  </span>
                  {s.document_id && (
                    <Link
                      href={`/library/${s.document_id}`}
                      className="inline-flex min-h-12 items-center gap-1 font-medium text-link hover:underline md:min-h-0"
                    >
                      Open document
                      <ArrowUpRightIcon className="size-3" aria-hidden />
                    </Link>
                  )}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ol>
      {(summary || children) && (
        <div className="flex flex-col gap-2 border-t px-4 py-2">
          {summary && (
            <p
              className="flex items-center gap-2 text-muted-foreground text-xs"
              data-testid="retrieval-summary"
            >
              <InfoIcon className="size-3 shrink-0" aria-hidden />
              {summary}
            </p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}
