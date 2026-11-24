"use client";

import { CheckCircle2Icon, MessageSquareWarningIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CheckRow, ChoiceCard } from "@/components/common/choice";
import { FilterTabs } from "@/components/common/filter-tabs";
import { Page, PageHeader } from "@/components/common/page";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { useCurrentUser } from "@/components/shell/current-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, type FeedbackItem, type Resolution } from "@/lib/api/client";
import { useInbox, useMyReports, useResolveItem } from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";

export const REASON_LABEL: Record<string, string> = {
  wrong: "Wrong",
  outdated: "Outdated",
  missing_source: "Missing information",
  not_relevant: "Not relevant",
  other: "Other",
};

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  fixed: "Fixed",
  no_change: "No change needed",
  marked_outdated: "Document marked outdated",
  duplicate: "Duplicate",
};

type Tab = "inbox" | "resolved" | "mine";

export function FeedbackScreen() {
  const me = useCurrentUser();
  const canReceive = me.user.role === "admin" || Boolean(me.owns_documents);
  const [tab, setTab] = useState<Tab>(canReceive ? "inbox" : "mine");
  const inbox = useInbox(tab === "resolved" ? "resolved" : "open", canReceive && tab !== "mine");
  const mine = useMyReports();
  const query = tab === "mine" ? mine : inbox;
  const items: FeedbackItem[] = (tab === "mine" ? mine.data : inbox.data?.items) ?? [];
  const [resolving, setResolving] = useState<FeedbackItem | null>(null);

  return (
    <Page>
      <PageHeader
        title="Feedback"
        description={
          canReceive
            ? "Answers and documents people flagged as wrong or outdated. Each one comes to the document's owner, or to Admins when there isn't one."
            : "What you've flagged, and what the document's owner did about it."
        }
      />
      <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label="Feedback items">
        {canReceive && (
          <div className="border-b p-4 md:px-6">
            <FilterTabs
              label="Show"
              value={tab}
              onChange={setTab}
              options={[
                { value: "inbox", label: "For you", count: inbox.data?.open_count },
                { value: "resolved", label: "Resolved" },
                { value: "mine", label: "Your reports" },
              ]}
            />
          </div>
        )}
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={MessageSquareWarningIcon}
            title={tab === "mine" ? "You haven't reported anything" : "Nothing waiting for you"}
            description={
              tab === "mine"
                ? "Use “Not helpful” on an answer, or “Report a problem” on a document."
                : "When someone flags an answer that cites your documents, it appears here."
            }
            testId="feedback-empty"
          />
        ) : (
          <ul className="divide-y" data-testid="feedback-list">
            {items.map((item) => (
              <FeedbackRow
                key={item.id}
                item={item}
                mine={tab === "mine"}
                onResolve={() => setResolving(item)}
              />
            ))}
          </ul>
        )}
      </section>
      <ResolveDialog item={resolving} onClose={() => setResolving(null)} />
    </Page>
  );
}

function FeedbackRow({
  item,
  mine,
  onResolve,
}: {
  item: FeedbackItem;
  mine: boolean;
  onResolve: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-4 md:px-6" data-testid="feedback-item">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={item.state === "open" ? "warning" : "outline"}>
          {item.state === "open" ? "Open" : item.resolution ? RESOLUTION_LABEL[item.resolution] : "Closed"}
        </Badge>
        <Badge variant="outline">{REASON_LABEL[item.reason] ?? item.reason}</Badge>
        <span className="text-muted-foreground text-xs">
          {item.kind === "answer" ? "Answer" : "Document"} ·{" "}
          {mine ? `sent to ${item.assigned_to}` : `from ${item.reporter_name}`} ·{" "}
          {relativeTime(item.created_at)}
        </span>
      </div>
      <p className="font-medium text-sm">
        {item.document ? (
          <Link href={`/library/${item.document.id}` as Route} className="text-link hover:underline">
            {item.document.title}
          </Link>
        ) : (
          (item.document_title ?? "A question Thinq couldn't answer")
        )}
      </p>
      {item.question && <p className="text-sm">“{item.question}”</p>}
      {item.comment && <p className="text-muted-foreground text-sm">{item.comment}</p>}
      {item.answer_excerpt && (
        <details className="text-sm">
          <summary className="cursor-pointer py-1 text-muted-foreground">The answer they got</summary>
          <p className="whitespace-pre-wrap rounded-md bg-muted p-4 text-muted-foreground">
            {item.answer_excerpt}
          </p>
        </details>
      )}
      {item.state === "resolved" && (
        <p className="text-muted-foreground text-sm" data-testid="feedback-outcome">
          {item.resolved_by_name ?? "Someone"} · {item.resolved_at ? relativeTime(item.resolved_at) : ""}
          {item.resolution_note ? ` — ${item.resolution_note}` : ""}
        </p>
      )}
      {!mine && item.can_resolve && (
        <div>
          <Button variant="outline" size="sm" onClick={onResolve}>
            Resolve
          </Button>
        </div>
      )}
    </li>
  );
}

const OUTCOMES: { value: Resolution; title: string; description: string }[] = [
  { value: "fixed", title: "Fixed", description: "The document or its status has been corrected." },
  { value: "no_change", title: "No change needed", description: "The answer was right. Say why below." },
  { value: "duplicate", title: "Duplicate", description: "Already reported and being handled." },
];

function ResolveDialog({ item, onClose }: { item: FeedbackItem | null; onClose: () => void }) {
  const resolve = useResolveItem();
  const [outcome, setOutcome] = useState<Resolution>("fixed");
  const [note, setNote] = useState("");
  const [markOutdated, setMarkOutdated] = useState(false);
  const reset = () => {
    setOutcome("fixed");
    setNote("");
    setMarkOutdated(false);
  };
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve this report</DialogTitle>
          <DialogDescription>{item?.reporter_name} will see what you chose and your note.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Outcome" className="flex flex-col gap-2">
          {OUTCOMES.map((o) => (
            <ChoiceCard
              key={o.value}
              selected={outcome === o.value}
              onSelect={() => setOutcome(o.value)}
              icon={CheckCircle2Icon}
              title={o.title}
              description={o.description}
            />
          ))}
        </div>
        {item?.document && item.document.status !== "outdated" && (
          <CheckRow
            id="mark-outdated"
            checked={markOutdated}
            onChange={setMarkOutdated}
            title={`Also mark “${item.document.title}” outdated`}
            description="Answers stop using it at once. Needs you to be its owner or an Admin."
          />
        )}
        <Field>
          <FieldLabel htmlFor="resolve-note">Note for the reporter</FieldLabel>
          <Textarea id="resolve-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={resolve.isPending}
            onClick={() =>
              item &&
              resolve.mutate(
                {
                  id: item.id,
                  resolution: outcome,
                  note: note.trim() || null,
                  mark_document_outdated: markOutdated,
                },
                {
                  onSuccess: () => {
                    toast.success("Resolved. The reporter can see the outcome.");
                    onClose();
                    reset();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            {resolve.isPending && <Spinner />}
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
