"use client";

import {
  ArchiveIcon,
  BadgeCheckIcon,
  CheckIcon,
  EyeOffIcon,
  FileTextIcon,
  LockIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  PencilLineIcon,
  QuoteIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Candidate = {
  title: string;
  status: string;
  icon: LucideIcon;
  tone: string;
  verdict: string;
  verdictIcon: LucideIcon;
  chosen?: boolean;
};

const CANDIDATES: Candidate[] = [
  {
    title: "Travel Policy v3",
    status: "Draft",
    icon: PencilLineIcon,
    tone: "text-warning bg-warning/10",
    verdict: "Newer, but not approved",
    verdictIcon: XIcon,
  },
  {
    title: "Travel Policy 2023",
    status: "Outdated",
    icon: ArchiveIcon,
    tone: "text-muted-foreground bg-secondary",
    verdict: "Replaced, kept for history",
    verdictIcon: XIcon,
  },
  {
    title: "Payroll Calendar",
    status: "Finance only",
    icon: LockIcon,
    tone: "text-foreground bg-secondary",
    verdict: "Not in your groups, never read",
    verdictIcon: EyeOffIcon,
  },
  {
    title: "Travel Policy v2",
    status: "Approved",
    icon: BadgeCheckIcon,
    tone: "text-success bg-success/10",
    verdict: "Official version",
    verdictIcon: CheckIcon,
    chosen: true,
  },
];

// 0 question · 1-4 each candidate judged · 5 answer · then a pause and loop
const LAST_STEP = 5;
const STEP_MS = 1100;
const HOLD_MS = 4200;

/**
 * An animated picture of what Thinq does with a question: it checks every
 * candidate document's status and access before anything is used, then answers
 * from the approved one and cites it. Pure illustration — no real data.
 */
export function TrustScene({ className, compact = false }: { className?: string; compact?: boolean }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? LAST_STEP : 0);

  useEffect(() => {
    if (reduce) {
      setStep(LAST_STEP);
      return;
    }
    const id = setTimeout(
      () => setStep((s) => (s >= LAST_STEP ? 0 : s + 1)),
      step >= LAST_STEP ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(id);
  }, [step, reduce]);

  return (
    <figure
      className={cn(
        "relative w-full rounded-2xl border bg-card p-4 text-card-foreground shadow-lg md:p-6",
        className,
      )}
      aria-label="Illustration: Thinq checks status and access for each document, then answers from the approved one and cites it."
      data-testid="trust-scene"
      data-step={step}
    >
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
            <MessageSquareTextIcon className="size-4" />
          </span>
          <motion.p
            key={`q-${step === 0}`}
            className="rounded-xl rounded-tl-sm bg-secondary px-4 py-2 text-sm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            Which travel policy should I follow?
          </motion.p>
        </div>

        <ul className="flex flex-col gap-2">
          {CANDIDATES.map((c, i) => {
            const judged = step > i;
            return (
              <motion.li
                key={c.title}
                layout
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                  judged && c.chosen && "border-primary bg-primary-subtle",
                )}
                animate={{ scale: judged && c.chosen ? 1.02 : 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 24 }}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", c.tone)}>
                  <c.icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate font-medium text-sm",
                      judged && !c.chosen && "line-through decoration-muted-foreground/60",
                    )}
                  >
                    <FileTextIcon className="mr-1 inline size-3 align-middle text-muted-foreground" />
                    {c.title}
                  </span>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={judged ? "verdict" : "status"}
                      className="truncate text-muted-foreground text-xs"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.25 }}
                    >
                      {judged ? c.verdict : c.status}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {judged && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 20 }}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full",
                        c.chosen ? "bg-success text-white" : "bg-secondary text-muted-foreground",
                      )}
                    >
                      <c.verdictIcon className="size-3" strokeWidth={3} />
                    </motion.span>
                  )}
                </span>
              </motion.li>
            );
          })}
        </ul>

        <div className={cn("min-h-24", compact && "min-h-20")}>
          <AnimatePresence>
            {step >= LAST_STEP && (
              <motion.div
                className="rounded-xl border bg-background p-4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-sm">
                  Book through the travel portal; economy for flights under six hours.
                </p>
                <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-success/10 px-2 py-1 font-medium text-success text-xs">
                  <QuoteIcon className="size-3" />
                  Travel Policy v2 · Approved
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </figure>
  );
}
