import { CheckIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = { id: string; label: string; icon: LucideIcon };

export function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.id}
            className="flex flex-1 items-center gap-2"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border font-medium text-xs",
                done && "border-foreground bg-foreground text-background",
                active && "border-primary bg-primary-subtle text-link",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? (
                <CheckIcon className="size-4" aria-hidden />
              ) : (
                <step.icon className="size-4" aria-hidden />
              )}
            </span>
            <span
              className={cn(
                "hidden truncate text-sm sm:block",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
            <span className="sr-only">{done ? "completed" : active ? "current step" : "not started"}</span>
          </li>
        );
      })}
    </ol>
  );
}
