"use client";

import {
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { GroupFormDialog } from "@/components/admin/group-form-dialog";
import { AddPeopleDialog } from "@/components/admin/membership-dialogs";
import { RoleBadge, UserStatus } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconTile, Page, PageHeader, Panel } from "@/components/common/page";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage, type GroupDetail, type GroupMember } from "@/lib/api/client";
import { useDeleteGroup, useGroup, useMembership, useUpdateGroup } from "@/lib/api/queries";
import { plural, relativeTime } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo";

export function GroupDetailScreen() {
  const { groupId } = useParams<{ groupId: string }>();
  const group = useGroup(groupId);
  if (group.isPending) {
    return (
      <Page>
        <div className="overflow-hidden rounded-xl border bg-card">
          <ListSkeleton rows={4} />
        </div>
      </Page>
    );
  }
  if (group.isError) {
    return (
      <Page>
        <ErrorState error={group.error} onRetry={() => group.refetch()} />
      </Page>
    );
  }
  return <GroupDetailView group={group.data} />;
}

function GroupDetailView({ group }: { group: GroupDetail }) {
  const router = useRouter();
  const update = useUpdateGroup(group.id);
  const remove = useDeleteGroup(group.id);
  const membership = useMembership();
  const [dialog, setDialog] = useState<"add" | "edit" | "delete" | null>(null);
  const closeDialog = (o: boolean) => !o && setDialog(null);

  const removeMember = (m: GroupMember) =>
    membership.mutate(
      { userId: m.id, groupId: group.id, action: "remove" },
      {
        onSuccess: () =>
          toastWithUndo({
            message: `${m.name} was removed from ${group.name}`,
            description: "This applies to their very next request.",
            undo: () => membership.mutateAsync({ userId: m.id, groupId: group.id, action: "add" }),
            undoneMessage: `${m.name} is back in ${group.name}`,
          }),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Page>
      <PageHeader
        leading={<IconTile icon={group.is_system ? LockIcon : UsersIcon} className="size-12" />}
        title={group.name}
        description={group.description || "No description."}
        meta={
          <>
            {group.is_system && <Badge variant="outline">System group</Badge>}
            <span className="text-muted-foreground text-sm tabular">
              {plural(group.member_count, "active member")}
            </span>
          </>
        }
        actions={
          <>
            {!group.is_system && (
              <Button onClick={() => setDialog("add")}>
                <UserPlusIcon />
                Add people
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialog("edit")}>
              <PencilIcon />
              Edit
            </Button>
            {!group.is_system && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon" aria-label="More actions" />}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                    <Trash2Icon />
                    Delete group
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <Panel
        icon={UsersIcon}
        title="Members"
        description={
          group.is_system
            ? "Every active user belongs to this group automatically."
            : "People here can see everything shared with this group."
        }
      >
        {group.members.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No one is in this group yet"
            description="Add the people who should see what's shared with it."
          />
        ) : (
          <ul className="divide-y">
            {group.members.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center md:px-6"
                data-testid={`member-row-${m.email}`}
              >
                <Link
                  href={`/admin/users/${m.id}`}
                  className="flex min-w-0 flex-1 items-center gap-4 rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <UserAvatar name={m.name} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-sm">{m.name}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {m.email}
                      {m.added_at && ` · added ${relativeTime(m.added_at).toLowerCase()}`}
                      {m.added_by && ` by ${m.added_by}`}
                    </span>
                  </span>
                </Link>
                <div className="flex items-center gap-4">
                  <RoleBadge role={m.role} />
                  <span className="hidden md:inline">
                    <UserStatus active={m.is_active} />
                  </span>
                  {!group.is_system && (
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => removeMember(m)}
                      disabled={membership.isPending}
                      aria-label={`Remove ${m.name}`}
                    >
                      <XIcon />
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {!group.is_system && (
        <AddPeopleDialog group={group} open={dialog === "add"} onOpenChange={closeDialog} />
      )}
      <GroupFormDialog
        open={dialog === "edit"}
        onOpenChange={closeDialog}
        title="Edit group"
        description={group.is_system ? "System groups can't be renamed." : "Renaming keeps every membership."}
        submitLabel="Save"
        nameLocked={group.is_system}
        initial={{ name: group.name, description: group.description ?? "" }}
        pending={update.isPending}
        onSubmit={(v) =>
          update.mutate(
            { ...(group.is_system ? {} : { name: v.name }), description: v.description || null },
            {
              onSuccess: () => {
                toast.success("Group saved");
                setDialog(null);
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={closeDialog}
        title={`Delete ${group.name}?`}
        description={`${plural(group.member_count, "person", "people")} will lose access to anything shared with this group, immediately. This can't be undone.`}
        confirmLabel="Delete group"
        confirmText={group.name}
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success(`${group.name} was deleted`);
              router.replace("/admin/groups");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Page>
  );
}
