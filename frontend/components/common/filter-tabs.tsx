"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Segmented control for switching a list's view. Behaves like a radio group. */
export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-lg bg-secondary p-1", className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled segmented control
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 font-medium text-sm transition-colors outline-none md:h-8 md:px-3 md:pointer-coarse:h-10",
              "focus-visible:ring-3 focus-visible:ring-ring/40",
              selected
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon && <o.icon className="size-4" aria-hidden />}
            {o.label}
            {o.count !== undefined && (
              <span className="text-muted-foreground text-xs tabular">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
