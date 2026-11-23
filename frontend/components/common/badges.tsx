import { CircleIcon, LockIcon, ShieldCheckIcon, UserIcon, UsersRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GroupRef, Role } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/** Roles are told apart by icon and label. Admin uses ink, never the accent. */
export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return role === "admin" ? (
    <Badge variant="ink" className={className}>
      <ShieldCheckIcon aria-hidden />
      Admin
    </Badge>
  ) : (
    <Badge variant="outline" className={className}>
      <UserIcon aria-hidden />
      Member
    </Badge>
  );
}

export function GroupChip({
  group,
  className,
}: {
  group: Pick<GroupRef, "name" | "is_system">;
  className?: string;
}) {
  return (
    <Badge variant={group.is_system ? "outline" : "default"} className={cn("max-w-full", className)}>
      {group.is_system ? <LockIcon aria-hidden /> : <UsersRoundIcon aria-hidden />}
      <span className="truncate">{group.name}</span>
    </Badge>
  );
}

export function GroupChips({
  groups,
  max = 3,
  hideSystem = false,
}: {
  groups: GroupRef[];
  max?: number;
  hideSystem?: boolean;
}) {
  const visible = hideSystem ? groups.filter((g) => !g.is_system) : groups;
  if (visible.length === 0) return <span className="text-muted-foreground text-sm">No groups</span>;
  const shown = visible.slice(0, max);
  const rest = visible.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((g) => (
        <GroupChip key={g.id} group={g} />
      ))}
      {rest > 0 && (
        <span
          className="text-muted-foreground text-xs"
          title={visible
            .slice(max)
            .map((g) => g.name)
            .join(", ")}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

const DOT = {
  success: "fill-success text-success",
  warning: "fill-warning text-warning",
  destructive: "fill-destructive text-destructive",
  muted: "fill-muted-foreground/60 text-muted-foreground/60",
} as const;

export function StatusDot({
  tone,
  label,
  pulse = false,
}: {
  tone: keyof typeof DOT;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="relative flex size-2">
        {pulse && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full bg-current opacity-50",
              DOT[tone],
            )}
          />
        )}
        <CircleIcon className={cn("relative size-2", DOT[tone])} aria-hidden />
      </span>
      {label}
    </span>
  );
}

export function UserStatus({ active }: { active: boolean }) {
  return <StatusDot tone={active ? "success" : "muted"} label={active ? "Active" : "Deactivated"} />;
}
