"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  FlagIcon,
  KeyRoundIcon,
  LibraryIcon,
  type LucideIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { AuditTimeline } from "@/components/admin/audit-list";
import { GroupChip, RoleBadge } from "@/components/common/badges";
import { Callout, DescriptionList, IconTile, Page, PageHeader, Panel } from "@/components/common/page";
import { useCurrentUser } from "@/components/shell/current-user";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttention, useAudit, useDocuments, useGroups, useUsers } from "@/lib/api/queries";
import { dateTime, greeting } from "@/lib/format";

export function Overview() {
  const { user } = useCurrentUser();
  const isAdmin = user.role === "admin";
  const firstName = user.name.split(" ")[0];

  return (
    <Page>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          isAdmin
            ? "Manage who can see what in your organization."
            : "Here's what you can access in Thinq today."
        }
        actions={
          isAdmin && (
            <ButtonLink href="/admin/users?add=1">
              <UserPlusIcon />
              Add user
            </ButtonLink>
          )
        }
      />
      {isAdmin && <OrgStats />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AccessPanel />
        {isAdmin ? <RecentActivity /> : <AccountPanel />}
      </div>
    </Page>
  );
}

function AccessPanel() {
  const { user } = useCurrentUser();
  return (
    <Panel
      icon={ShieldCheckIcon}
      title="Your access"
      description="You can see anything shared with these groups."
    >
      <ul className="divide-y" data-testid="my-groups">
        {user.groups.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-4 px-4 py-4 md:px-6">
            <GroupChip group={g} />
            <span className="text-muted-foreground text-xs">
              {g.is_system ? "Everyone in your organization" : "Assigned by an Admin"}
            </span>
          </li>
        ))}
      </ul>
      <LibraryLink />
      <div className="px-4 pb-4 md:px-6 md:pb-6">
        <Callout icon={ShieldCheckIcon}>
          Access is checked every time you use Thinq. If an Admin changes your groups, it applies to your very
          next action — there&apos;s no need to sign out.
        </Callout>
      </div>
    </Panel>
  );
}

function AccountPanel() {
  const { user, session } = useCurrentUser();
  return (
    <Panel
      icon={UserCircleIcon}
      title="Your account"
      actions={
        <ButtonLink href="/profile" variant="outline" size="sm">
          View profile
          <ArrowRightIcon />
        </ButtonLink>
      }
    >
      <DescriptionList
        compact
        items={[
          { label: "Role", icon: ShieldCheckIcon, value: <RoleBadge role={user.role} /> },
          { label: "Title", icon: UserCircleIcon, value: user.title ?? "—" },
          { label: "Session ends", icon: KeyRoundIcon, value: dateTime(session.expires_at) },
        ]}
      />
    </Panel>
  );
}

function Stat({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  href: Route;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs outline-none transition-colors hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40 md:p-6"
    >
      <IconTile icon={icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-muted-foreground text-sm">{label}</span>
        {value === undefined ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <span className="font-semibold text-xl tabular tracking-tight">{value}</span>
        )}
      </span>
      <ArrowRightIcon
        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1"
        aria-hidden
      />
    </Link>
  );
}

function OrgStats() {
  const active = useUsers({ status: "active", limit: 1 });
  const admins = useUsers({ role: "admin", status: "active", limit: 1 });
  const attention = useAttention();
  const groups = useGroups();
  return (
    <section aria-label="Organization at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Active users" value={active.data?.total} icon={UsersIcon} href="/admin/users" />
      <Stat label="Admins" value={admins.data?.total} icon={ShieldCheckIcon} href="/admin/users" />
      <Stat label="Groups" value={groups.data?.length} icon={UsersRoundIcon} href="/admin/groups" />
      <Stat label="Needs attention" value={attention.data?.length} icon={FlagIcon} href="/admin/attention" />
    </section>
  );
}

function RecentActivity() {
  const audit = useAudit({ limit: 5 });
  return (
    <Panel
      icon={ActivityIcon}
      title="Recent activity"
      description="Sign-ins and access changes."
      actions={
        <ButtonLink href="/admin/audit" variant="outline" size="sm">
          Audit log
          <ArrowRightIcon />
        </ButtonLink>
      }
    >
      <AuditTimeline events={audit.data?.items} loading={audit.isPending} />
    </Panel>
  );
}

function LibraryLink() {
  const docs = useDocuments({ limit: 1 });
  const total = docs.data ? Object.values(docs.data.status_counts).reduce((a, b) => a + b, 0) : undefined;
  return (
    <div className="flex items-center justify-between gap-4 border-t px-4 py-4 md:px-6">
      <span className="flex items-center gap-2 text-sm">
        <LibraryIcon className="size-4 text-muted-foreground" aria-hidden />
        {total === undefined ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          <span>
            You can see <span className="font-semibold tabular">{total}</span> document
            {total === 1 ? "" : "s"}
          </span>
        )}
      </span>
      <ButtonLink href="/library" variant="outline" size="sm">
        Open library
        <ArrowRightIcon />
      </ButtonLink>
    </div>
  );
}
