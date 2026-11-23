"use client";

import { ChevronRightIcon, LockIcon, PlusIcon, UsersIcon, UsersRoundIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { GroupFormDialog } from "@/components/admin/group-form-dialog";
import { IconTile, Page, PageHeader } from "@/components/common/page";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import { useCreateGroup, useGroups } from "@/lib/api/queries";
import { plural } from "@/lib/format";

export function GroupsScreen() {
  const groups = useGroups();
  const create = useCreateGroup();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Page>
      <PageHeader
        title="Groups"
        description="Documents are shared with groups, never with individuals. Add people to a group to give them access."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            New group
          </Button>
        }
      />

      {groups.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.data.map((g) => (
            <li key={g.id}>
              <Link
                href={`/admin/groups/${g.id}`}
                className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-6 shadow-xs outline-none transition-colors hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40"
                data-testid={`group-card-${g.slug}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <IconTile icon={g.is_system ? LockIcon : UsersRoundIcon} />
                  {g.is_system && <Badge variant="outline">System</Badge>}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <span className="font-semibold text-base">{g.name}</span>
                  <span className="line-clamp-2 text-muted-foreground text-sm">
                    {g.description || "No description."}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-4 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <UsersIcon className="size-4" aria-hidden />
                    <span className="tabular">{plural(g.member_count, "active member")}</span>
                  </span>
                  <ChevronRightIcon
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <GroupFormDialog
        open={open}
        onOpenChange={setOpen}
        title="New group"
        description="Create a group, then add people to it."
        submitLabel="Create group"
        pending={create.isPending}
        onSubmit={(v) =>
          create.mutate(
            { name: v.name, description: v.description || null },
            {
              onSuccess: (group) => {
                toast.success(`${group.name} was created`, {
                  description: "Now add the people who belong in it.",
                });
                setOpen(false);
                router.push(`/admin/groups/${group.id}`);
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
    </Page>
  );
}
