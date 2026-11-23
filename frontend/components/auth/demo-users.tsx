"use client";

import { ChevronRightIcon } from "lucide-react";
import { GroupChips, RoleBadge } from "@/components/common/badges";
import { UserAvatar } from "@/components/common/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { DemoUser } from "@/lib/api/client";

export function DemoUserList({
  users,
  loading,
  pendingId,
  onSelect,
}: {
  users: DemoUser[] | undefined;
  loading: boolean;
  pendingId: string | null;
  onSelect: (user: DemoUser) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (!users || users.length === 0) {
    return <p className="text-muted-foreground text-sm">No demo users are available yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Demo users">
      {users.map((user) => (
        <li key={user.id}>
          <button
            type="button"
            onClick={() => onSelect(user)}
            disabled={pendingId !== null}
            className="group flex min-h-16 w-full items-center gap-4 rounded-lg border bg-background px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
          >
            <UserAvatar name={user.name} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{user.name}</span>
                <RoleBadge role={user.role} />
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {user.title && <span className="text-muted-foreground text-xs">{user.title}</span>}
                <GroupChips groups={user.groups} hideSystem />
              </span>
            </span>
            {pendingId === user.id ? (
              <Spinner className="text-muted-foreground" />
            ) : (
              <ChevronRightIcon
                className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
