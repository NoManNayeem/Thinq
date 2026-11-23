import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <circle cx="15" cy="15" r="6.5" fill="none" stroke="white" strokeWidth="3" />
      <path d="M19.6 19.6 24 24" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <circle cx="15" cy="15" r="1.75" fill="#c7d2fe" />
    </svg>
  );
}

/** `tone="ink"` for use on the dark sidebar and brand panel. */
export function Logo({ className, tone = "default" }: { className?: string; tone?: "default" | "ink" }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark />
      <span
        className={cn(
          "font-semibold text-lg tracking-tight",
          tone === "ink" ? "text-ink-foreground" : "text-foreground",
        )}
      >
        Thinq
      </span>
    </span>
  );
}
