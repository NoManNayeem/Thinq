"use client";

import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { type ChatFeedback, errorMessage, type Schemas } from "@/lib/api/client";
import { useMessageFeedback } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

type Reason = NonNullable<Schemas["FeedbackIn"]["reason"]>;

const REASONS: { value: Reason; label: string }[] = [
  { value: "wrong", label: "Wrong" },
  { value: "outdated", label: "Out of date" },
  { value: "missing_source", label: "Missing a source" },
  { value: "not_relevant", label: "Not relevant" },
  { value: "other", label: "Something else" },
];

export function FeedbackControls({
  messageId,
  initial,
}: {
  messageId: string;
  initial: ChatFeedback | null;
}) {
  const save = useMessageFeedback();
  const [current, setCurrent] = useState<ChatFeedback | null>(initial);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("wrong");
  const [comment, setComment] = useState("");

  const send = (body: Schemas["FeedbackIn"] | null, done?: () => void) =>
    save.mutate(
      { messageId, body },
      {
        onSuccess: (result) => {
          setCurrent(body ? (result as ChatFeedback) : null);
          if (body?.rating === "down") {
            const to = (result as ChatFeedback | null)?.report?.assigned_to;
            toast.success(to ? `Sent to ${to}` : "Thanks — feedback saved");
          } else if (body) toast.success("Thanks — feedback saved");
          done?.();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Helpful"
        aria-pressed={current?.rating === "up"}
        className={cn(current?.rating === "up" && "bg-secondary")}
        disabled={save.isPending}
        onClick={() => send(current?.rating === "up" ? null : { rating: "up" })}
      >
        <ThumbsUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Not helpful"
        aria-pressed={current?.rating === "down"}
        className={cn(current?.rating === "down" && "bg-secondary")}
        disabled={save.isPending}
        onClick={() => (current?.rating === "down" ? send(null) : setOpen(true))}
      >
        <ThumbsDownIcon />
      </Button>

      {current?.report && <ReportStatus report={current.report} />}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What was wrong with this answer?</DialogTitle>
            <DialogDescription>
              It goes to the owners of the documents this answer cited (or to Admins), together with your
              question and the answer, so they can fix it. You&apos;ll see what they did under Feedback.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              // biome-ignore lint/a11y/useSemanticElements: chip-style radio
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={reason === r.value}
                onClick={() => setReason(r.value)}
                className={cn(
                  "h-12 rounded-lg border px-4 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 md:h-10",
                  reason === r.value ? "border-primary bg-primary-subtle font-medium" : "hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor={`fb-${messageId}`}>
              Details <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id={`fb-${messageId}`}
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
              disabled={save.isPending}
              onClick={() =>
                send({ rating: "down", reason, comment: comment.trim() || null }, () => {
                  setOpen(false);
                  setComment("");
                })
              }
            >
              {save.isPending && <Spinner />}
              Send feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReportStatus({ report }: { report: NonNullable<ChatFeedback["report"]> }) {
  const label =
    report.state === "open"
      ? `Reported to ${report.assigned_to}`
      : `${report.resolved_by_name ?? "Owner"}: ${
          report.resolution === "no_change"
            ? "no change needed"
            : report.resolution === "marked_outdated"
              ? "marked the document outdated"
              : report.resolution === "duplicate"
                ? "already being handled"
                : "fixed"
        }`;
  return (
    <span
      className="ml-2 text-muted-foreground text-xs"
      data-testid="report-status"
      title={report.resolution_note ?? undefined}
    >
      {label}
      {report.resolution_note ? ` — ${report.resolution_note}` : ""}
    </span>
  );
}
