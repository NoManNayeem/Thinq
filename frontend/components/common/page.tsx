import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Content column. Spacing: 16 px gutters on phones, 32 px on desktop; 24 / 32 px vertical rhythm. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  leading,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Put at most one primary (default-variant) button here. */
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {leading}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
          {description && <p className="max-w-2xl text-muted-foreground text-sm">{description}</p>}
          {meta && <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function IconTile({
  icon: Icon,
  tone = "neutral",
  className,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "success" | "warning" | "destructive" | "ink";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        tone === "neutral" && "bg-secondary text-foreground",
        tone === "ink" && "bg-ink text-ink-foreground",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "destructive" && "bg-destructive/10 text-destructive",
        className,
      )}
      aria-hidden
    >
      <Icon className="size-5" />
    </span>
  );
}

/** A white surface with an icon-led header. The basic building block of every screen. */
export function Panel({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <div className="flex flex-col gap-4 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          {icon && <IconTile icon={icon} />}
          <div className="min-w-0">
            <h2 className="font-semibold text-base">{title}</h2>
            {description && <p className="text-muted-foreground text-sm">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function DescriptionList({
  items,
  compact = false,
}: {
  items: { label: string; value: React.ReactNode; icon?: LucideIcon }[];
  compact?: boolean;
}) {
  return (
    <dl className="divide-y">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "px-4 py-4 md:px-6",
            compact
              ? "flex items-center justify-between gap-4"
              : "grid gap-1 sm:grid-cols-[200px_1fr] sm:gap-4",
          )}
        >
          <dt className="flex items-center gap-2 text-muted-foreground text-sm">
            {item.icon && <item.icon className="size-4" aria-hidden />}
            {item.label}
          </dt>
          <dd className={cn("min-w-0 text-sm", compact && "text-right")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({
  icon: Icon,
  children,
  tone = "neutral",
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg p-4 text-sm",
        tone === "neutral" ? "bg-muted text-muted-foreground" : "bg-warning/10 text-foreground",
      )}
    >
      <Icon
        className={cn("mt-1 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-foreground")}
        aria-hidden
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
