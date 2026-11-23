"use client";

import { CheckIcon, type LucideIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** A large, clearly labelled radio option with an explanation. */
export function ChoiceCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: card-style radio option
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-4 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        selected ? "border-primary bg-primary-subtle" : "border-border bg-background hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          selected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
        )}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-muted-foreground text-sm">{description}</span>
      </span>
      <span
        className={cn(
          "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
        aria-hidden
      >
        {selected && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** A full-width row with a checkbox. The whole row is the tap target (≥ 48 px). */
export function CheckRow({
  id,
  checked,
  onChange,
  title,
  description,
  leading,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 transition-colors",
        checked ? "border-primary bg-primary-subtle" : "border-border hover:bg-muted",
      )}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm">{title}</span>
        {description && <span className="truncate text-muted-foreground text-xs">{description}</span>}
      </span>
    </label>
  );
}
