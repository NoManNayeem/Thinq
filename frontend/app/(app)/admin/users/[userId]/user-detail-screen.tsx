"use client";

import {
  BanIcon,
  CalendarIcon,
  ClockIcon,
  HistoryIcon,
  IdCardIcon,
  KeyRoundIcon,
  LockIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuditTimeline } from "@/components/admin/audit-list";
import { AddToGroupsDialog } from "@/components/admin/membership-dialogs";
import { EditProfileDialog, ResetPasswordDialog } from "@/components/admin/user-dialogs";
import { GroupChip, RoleBadge, UserStatus } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Callout, DescriptionList, Page, PageHeader, Panel } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, type Role, type UserDetail } from "@/lib/api/client";
import {
  useAudit,
  useGroups,
  useMembership,
  useRevokeSessions,
  useUpdateUser,
  useUser,
} from "@/lib/api/queries";
import { dateTime, plural, relativeTime } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo";

export function UserDetailScreen() {
  const { userId } = useParams<{ userId: string }>();
  const user = useUser(userId);

  if (user.isPending) {
    return (
      <Page>
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }
  if (user.isError) {
    return (
      <Page>
        <ErrorState error={user.error} onRetry={() => user.refetch()} />
      </Page>
    );
  }
  return <UserDetailView user={user.data} />;
}

function UserDetailView({ user }: { user: UserDetail }) {
  const { user: me } = useCurrentUser();
  const isSelf = me.id === user.id;
  const update = useUpdateUser(user.id);
  const revoke = useRevokeSessions(user.id);
  const groups = useGroups();
  const [dialog, setDialog] = useState<"groups" | "profile" | "password" | "deactivate" | "signout" | null>(
    null,
  );
  const closeDialog = (o: boolean) => !o && setDialog(null);

  const canAddGroups =
    user.is_active &&
    (groups.data ?? []).some((g) => !g.is_system && !user.groups.some((ug) => ug.id === g.id));

  const setActive = (active: boolean) =>
    update.mutate(
      { is_active: active },
      {
        onSuccess: () => {
          setDialog(null);
          if (active) {
            toast.success(`${user.name} can sign in again`);
          } else {
            toastWithUndo({
              message: `${user.name} was deactivated`,
              description: "They were signed out everywhere.",
              undo: () => update.mutateAsync({ is_active: true }),
              undoneMessage: `${user.name} was reactivated`,
            });
          }
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Page>
      <PageHeader
        leading={<UserAvatar name={user.name} size="lg" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {user.name}
            {isSelf && <span className="font-normal text-base text-muted-foreground">(you)</span>}
          </span>
        }
        description={user.title ? `${user.title} · ${user.email}` : user.email}
        meta={
          <>
            <RoleBadge role={user.role} />
            <UserStatus active={user.is_active} />
          </>
        }
        actions={
          <>
            <Button onClick={() => setDialog("groups")} disabled={!canAddGroups}>
              <UserPlusIcon />
              Add to group
            </Button>
            <Button variant="outline" onClick={() => setDialog("profile")}>
              <PencilIcon />
              Edit profile
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label="More actions" />}
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={() => setDialog("password")}>
                  <KeyRoundIcon />
                  {user.has_password ? "Reset password" : "Set password"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDialog("signout")}
                  disabled={user.active_session_count === 0}
                >
                  <LogOutIcon />
                  Sign out everywhere
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {user.is_active ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDialog("deactivate")}
                    disabled={isSelf}
                  >
                    <BanIcon />
                    Deactivate user
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setActive(true)}>
                    <RotateCcwIcon />
                    Reactivate user
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {!user.is_active && (
        <Callout icon={ShieldAlertIcon} tone="warning">
          <span className="font-medium text-foreground">This user is deactivated.</span> They can&apos;t sign
          in and aren&apos;t counted in any group. Their history is kept.
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <GroupAccess user={user} />
          <UserActivity userId={user.id} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <RolePanel user={user} isSelf={isSelf} />
          <Panel icon={IdCardIcon} title="Account">
            <DescriptionList
              compact
              items={[
                { label: "Last sign-in", icon: ClockIcon, value: relativeTime(user.last_login_at) },
                {
                  label: "Active sessions",
                  icon: MonitorSmartphoneIcon,
                  value: <span className="tabular">{user.active_session_count}</span>,
                },
                { label: "Password", icon: LockIcon, value: user.has_password ? "Set" : "Not set" },
                { label: "Created", icon: CalendarIcon, value: dateTime(user.created_at) },
              ]}
            />
          </Panel>
        </div>
      </div>

      <AddToGroupsDialog user={user} open={dialog === "groups"} onOpenChange={closeDialog} />
      <EditProfileDialog user={user} open={dialog === "profile"} onOpenChange={closeDialog} />
      <ResetPasswordDialog user={user} open={dialog === "password"} onOpenChange={closeDialog} />
      <ConfirmDialog
        open={dialog === "deactivate"}
        onOpenChange={closeDialog}
        title={`Deactivate ${user.name}?`}
        description="They're signed out immediately and can't sign in until reactivated. Their groups are kept, so reactivating restores their access."
        confirmLabel="Deactivate"
        destructive
        pending={update.isPending}
        onConfirm={() => setActive(false)}
      />
      <ConfirmDialog
        open={dialog === "signout"}
        onOpenChange={closeDialog}
        title="Sign out everywhere?"
        description={`Ends ${plural(user.active_session_count, "active session")}${isSelf ? " on your other devices" : ""}. They can sign in again.`}
        confirmLabel="Sign out"
        pending={revoke.isPending}
        onConfirm={() =>
          revoke.mutate(undefined, {
            onSuccess: () => {
              toast.success("Sessions ended");
              setDialog(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Page>
  );
}

function GroupAccess({ user }: { user: UserDetail }) {
  const membership = useMembership();

  const remove = (groupId: string, groupName: string) =>
    membership.mutate(
      { userId: user.id, groupId, action: "remove" },
      {
        onSuccess: () =>
          toastWithUndo({
            message: `Removed from ${groupName}`,
            description: "This applies to their very next request.",
            undo: () => membership.mutateAsync({ userId: user.id, groupId, action: "add" }),
            undoneMessage: `${user.name} is back in ${groupName}`,
          }),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Panel
      icon={UsersRoundIcon}
      title="Group access"
      description="Groups decide which documents this person can see."
    >
      <ul className="divide-y" data-testid="user-groups">
        {user.groups.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
            <GroupChip group={g} />
            {g.is_system ? (
              <span className="flex h-12 items-center text-muted-foreground text-xs md:h-8">Automatic</span>
            ) : (
              <Button
                variant="destructive-ghost"
                size="sm"
                onClick={() => remove(g.id, g.name)}
                disabled={membership.isPending}
                aria-label={`Remove from ${g.name}`}
              >
                <XIcon />
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RolePanel({ user, isSelf }: { user: UserDetail; isSelf: boolean }) {
  const update = useUpdateUser(user.id);
  const label = (r: Role) => (r === "admin" ? "an Admin" : "a Member");
  const change = (role: Role) => {
    const previous = user.role;
    update.mutate(
      { role },
      {
        onSuccess: () =>
          toastWithUndo({
            message: `${user.name} is now ${label(role)}`,
            undo: () => update.mutateAsync({ role: previous }),
            undoneMessage: `${user.name} is ${label(previous)} again`,
          }),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };
  return (
    <Panel
      icon={ShieldCheckIcon}
      title="Role"
      description="Admins manage people and groups. A role never grants document access."
    >
      <div className="flex flex-col gap-2 p-4 md:p-6">
        <SimpleSelect
          id="role"
          label="Role"
          className="md:w-full"
          value={user.role}
          disabled={isSelf || update.isPending || !user.is_active}
          onChange={change}
          options={[
            { value: "member", label: "Member" },
            { value: "admin", label: "Admin" },
          ]}
        />
        {isSelf && (
          <p className="text-muted-foreground text-xs">
            You can&apos;t change your own role. Ask another Admin.
          </p>
        )}
      </div>
    </Panel>
  );
}

function UserActivity({ userId }: { userId: string }) {
  const audit = useAudit({ target_id: userId, limit: 10 });
  return (
    <Panel icon={HistoryIcon} title="Recent activity" description="Changes made to this person's account.">
      <AuditTimeline events={audit.data?.items} loading={audit.isPending} showTarget={false} />
    </Panel>
  );
}
