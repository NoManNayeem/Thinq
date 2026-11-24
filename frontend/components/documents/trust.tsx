"use client";

import {
  ArchiveIcon,
  BadgeCheckIcon,
  BookMarkedIcon,
  CalendarCheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  FlagIcon,
  GitBranchIcon,
  HistoryIcon,
  LightbulbIcon,
  type LucideIcon,
  PencilLineIcon,
  XCircleIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ChoiceCard } from "@/components/common/choice";
import { Callout, Panel } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  type DocumentDetail,
  type DocumentStatus,
  errorMessage,
  type Proposal,
  type ReportReason,
  type StatusAction,
} from "@/lib/api/client";
import { useChangeStatus, useDecideProposal, useDocumentHistory, useReportDocument } from "@/lib/api/queries";
import { STATUS } from "@/lib/documents";
import { dateTime, relativeTime } from "@/lib/format";
import { StatusBadge } from "./status-badge";

type ActionMeta = {
  label: string;
  icon: LucideIcon;
  describe: (doc: DocumentDetail) => string;
  noteRequired?: boolean;
};

export const ACTION: Record<StatusAction, ActionMeta> = {
  approve: {
    label: "Approve",
    icon: BadgeCheckIcon,
    describe: (doc) => {
      const current = (doc.family ?? []).find((m) => m.is_current && !m.is_self);
      return current
        ? `Makes this the official version. “${current.title}” is marked Outdated in the same step.`
        : "Makes this the official version, safe to use and share.";
    },
  },
  review: {
    label: "Confirm it's still correct",
    icon: CalendarCheckIcon,
    describe: () => "Records today as the last review date. Status stays Approved.",
  },
  reject: {
    label: "Reject draft",
    icon: XCircleIcon,
    describe: () => "Keeps it as a draft and records why, so the owner knows what to change.",
    noteRequired: true,
  },
  mark_outdated: {
    label: "Mark outdated",
    icon: ArchiveIcon,
    describe: () => "Kept for history only. Answers stop using it at once.",
  },
  mark_reference: {
    label: "Mark as reference",
    icon: BookMarkedIcon,
    describe: () => "Useful background, not a policy or procedure. Ranked below approved documents.",
  },
  mark_draft: {
    label: "Return to draft",
    icon: PencilLineIcon,
    describe: () => "Not for use until it's approved again.",
  },
};

const AVAILABLE: Record<DocumentStatus, StatusAction[]> = {
  draft: ["approve", "reject", "mark_reference", "mark_outdated"],
  unknown: ["approve", "mark_draft", "mark_reference", "mark_outdated"],
  approved: ["review", "mark_outdated", "mark_draft", "mark_reference"],
  reference: ["approve", "mark_outdated"],
  outdated: ["approve", "mark_draft"],
};

/** Header actions for the owner or an Admin: one primary action, the rest in a menu. */
export function StatusActions({ doc }: { doc: DocumentDetail }) {
  const [action, setAction] = useState<StatusAction | null>(null);
  if (!doc.can_change_status) return null;
  const actions = AVAILABLE[doc.status];
  const primary: StatusAction | null =
    doc.status === "draft" || doc.status === "unknown" ? "approve" : doc.review_overdue ? "review" : null;
  const rest = actions.filter((a) => a !== primary);
  return (
    <>
      {primary && (
        <Button onClick={() => setAction(primary)} data-testid="status-primary">
          {(() => {
            const Icon = ACTION[primary].icon;
            return <Icon />;
          })()}
          {ACTION[primary].label}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" data-testid="status-menu" />}>
          Change status
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {rest.map((a) => {
            const Icon = ACTION[a].icon;
            return (
              <DropdownMenuItem key={a} onClick={() => setAction(a)}>
                <Icon />
                {ACTION[a].label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <StatusDialog doc={doc} action={action} onClose={() => setAction(null)} />
    </>
  );
}

function StatusDialog({
  doc,
  action,
  onClose,
}: {
  doc: DocumentDetail;
  action: StatusAction | null;
  onClose: () => void;
}) {
  const change = useChangeStatus(doc.id);
  const [note, setNote] = useState("");
  const meta = action ? ACTION[action] : null;
  const blocked = Boolean(meta?.noteRequired && note.trim().length < 3);
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setNote("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meta?.label}</DialogTitle>
          <DialogDescription>{meta?.describe(doc)}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="status-note">
            {meta?.noteRequired ? "What needs to change?" : "Note (optional)"}
          </FieldLabel>
          <Textarea id="status-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <FieldDescription>Recorded in the document's history with your name.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={blocked || change.isPending}
            onClick={() =>
              action &&
              change.mutate(
                { action, note: note.trim() || null },
                {
                  onSuccess: () => {
                    toast.success(action === "review" ? "Review recorded" : "Status updated");
                    onClose();
                    setNote("");
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            {change.isPending && <Spinner />}
            {meta?.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "The approved memo says this is current": evidence, never applied without a person. */
export function ProposalCard({
  proposal,
  showDocument = false,
}: {
  proposal: Proposal;
  showDocument?: boolean;
}) {
  const decide = useDecideProposal();
  const target = STATUS[proposal.proposed_status];
  const run = (accept: boolean) =>
    decide.mutate(
      { id: proposal.id, accept },
      {
        onSuccess: () => toast.success(accept ? `Marked ${target.label}` : "Proposal dismissed"),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-primary-subtle/40 p-4" data-testid="proposal">
      <div className="flex items-start gap-3">
        <LightbulbIcon className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <p>
            {showDocument && (
              <>
                <Link
                  href={`/library/${proposal.document.id}` as Route}
                  className="font-medium text-link hover:underline"
                >
                  {proposal.document.title}
                </Link>{" "}
                ·{" "}
              </>
            )}
            The approved document{" "}
            <Link
              href={`/library/${proposal.evidence.id}` as Route}
              className="font-medium text-link hover:underline"
            >
              {proposal.evidence.title}
            </Link>{" "}
            suggests marking {showDocument ? "it" : "this"}{" "}
            <span className="font-medium">{target.label}</span>.
          </p>
          <blockquote className="border-l-2 pl-4 text-muted-foreground">
            “{proposal.evidence_text}”
          </blockquote>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-7">
        <Button variant="outline" size="sm" disabled={decide.isPending} onClick={() => run(true)}>
          <CircleCheckIcon />
          Mark {target.label}
        </Button>
        <Button variant="ghost" size="sm" disabled={decide.isPending} onClick={() => run(false)}>
          Not right
        </Button>
      </div>
    </div>
  );
}

export function TrustCallouts({ doc }: { doc: DocumentDetail }) {
  return (
    <>
      {doc.superseded_by && (
        <Callout icon={GitBranchIcon}>
          Replaced by{" "}
          <Link
            href={`/library/${doc.superseded_by.id}` as Route}
            className="font-medium text-link hover:underline"
          >
            {doc.superseded_by.title}
          </Link>
          , the current version.
        </Callout>
      )}
      {doc.review_overdue && (
        <Callout icon={CalendarCheckIcon} tone="warning">
          <span className="font-medium">Review overdue</span> since{" "}
          {dateTime(doc.review_due ?? "").replace(/, \d\d:\d\d$/, "")}. Ask the owner to confirm it's still
          correct.
        </Callout>
      )}
      {(doc.proposals ?? []).map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
    </>
  );
}

export function FamilyPanel({ doc }: { doc: DocumentDetail }) {
  if ((doc.family ?? []).length < 2) return null;
  return (
    <Panel
      icon={GitBranchIcon}
      title="Versions of this document"
      description="The approved one is current, even if newer drafts exist."
    >
      <ol className="divide-y" data-testid="family">
        {(doc.family ?? []).map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-2 md:px-6">
            <span className="flex min-w-0 flex-col">
              {m.is_self ? (
                <span className="truncate font-medium text-sm">{m.title}</span>
              ) : (
                <Link
                  href={`/library/${m.id}` as Route}
                  className="truncate text-link text-sm hover:underline"
                >
                  {m.title}
                </Link>
              )}
              <span className="text-muted-foreground text-xs">
                {m.is_current ? "Current version · " : ""}
                changed {m.last_modified ?? "—"}
              </span>
            </span>
            <StatusBadge status={m.status} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  approve: "Approved",
  superseded: "Replaced by a newer approved version",
  reject: "Draft rejected",
  review: "Confirmed still correct",
  mark_outdated: "Marked outdated",
  mark_reference: "Marked as reference",
  mark_draft: "Returned to draft",
};

export function HistoryPanel({ docId }: { docId: string }) {
  const history = useDocumentHistory(docId);
  return (
    <Panel icon={HistoryIcon} title="Approval history">
      {history.isPending ? (
        <div className="p-4">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !history.data?.length ? (
        <p className="px-4 py-4 text-muted-foreground text-sm md:px-6">
          No changes yet. Status came from the manifest.
        </p>
      ) : (
        <ol className="divide-y" data-testid="history">
          {history.data.map((h) => (
            <li key={h.id} className="flex flex-col gap-1 px-4 py-2 text-sm md:px-6">
              <span className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}</span>
              <span className="text-muted-foreground text-xs">
                {h.actor_name ?? "Thinq"} · {relativeTime(h.created_at)}
              </span>
              {h.note && <span className="text-muted-foreground">{h.note}</span>}
              {h.evidence && (
                <span className="text-muted-foreground text-xs">
                  Evidence:{" "}
                  <Link href={`/library/${h.evidence.id}` as Route} className="text-link hover:underline">
                    {h.evidence.title}
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

const REASONS: { value: ReportReason; label: string; description: string; icon: LucideIcon }[] = [
  {
    value: "outdated",
    label: "Outdated",
    description: "Something here has changed since it was written.",
    icon: ArchiveIcon,
  },
  { value: "wrong", label: "Wrong", description: "It says something that isn't true.", icon: XCircleIcon },
  {
    value: "missing_source",
    label: "Missing something",
    description: "An important step or detail isn't here.",
    icon: LightbulbIcon,
  },
  { value: "other", label: "Something else", description: "Explain below.", icon: FlagIcon },
];

export function ReportButton({ doc }: { doc: DocumentDetail }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("outdated");
  const [comment, setComment] = useState("");
  const report = useReportDocument(doc.id);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} data-testid="report-document">
        <FlagIcon />
        Report a problem
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report a problem with this document</DialogTitle>
            <DialogDescription>
              It goes to {doc.owner.has_account && doc.owner.name ? doc.owner.name : "the Admins"}, who can
              fix it. You'll see what they did under Feedback.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="What's wrong?" className="flex flex-col gap-2">
            {REASONS.map((r) => (
              <ChoiceCard
                key={r.value}
                selected={reason === r.value}
                onSelect={() => setReason(r.value)}
                icon={r.icon}
                title={r.label}
                description={r.description}
              />
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="report-comment">Details (optional)</FieldLabel>
            <Textarea
              id="report-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={report.isPending}
              onClick={() =>
                report.mutate(
                  { reason, comment: comment.trim() || null },
                  {
                    onSuccess: (item) => {
                      toast.success(`Sent to ${item.assigned_to}`);
                      setOpen(false);
                      setComment("");
                    },
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              {report.isPending && <Spinner />}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
