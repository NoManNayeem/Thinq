"use client";

import {
  ActivityIcon,
  BadgeCheckIcon,
  DatabaseIcon,
  FlagIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  type LucideIcon,
  MessageSquareWarningIcon,
  MessagesSquareIcon,
  NetworkIcon,
  ScrollTextIcon,
  UserCircleIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApprovals, useAttention, useInbox } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: "attention" | "approvals" | "inbox";
  /** Only shown to people who can approve (document owners and Admins). */
  approversOnly?: boolean;
};

export const WORKSPACE_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon, exact: true },
  { href: "/chat" as Route, label: "Ask Thinq", icon: MessagesSquareIcon },
  { href: "/library", label: "Library", icon: LibraryIcon },
  { href: "/knowledge" as Route, label: "Knowledge graph", icon: NetworkIcon },
  {
    href: "/approvals" as Route,
    label: "Approvals",
    icon: BadgeCheckIcon,
    badge: "approvals",
    approversOnly: true,
  },
  { href: "/feedback" as Route, label: "Feedback", icon: MessageSquareWarningIcon, badge: "inbox" },
  { href: "/profile", label: "Your profile", icon: UserCircleIcon },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/attention", label: "Needs attention", icon: FlagIcon, badge: "attention" },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/groups", label: "Groups", icon: UsersRoundIcon },
  { href: "/admin/sources" as Route, label: "Sources and sync", icon: DatabaseIcon },
  { href: "/admin/quality" as Route, label: "Answer quality", icon: GaugeIcon },
  { href: "/admin/audit", label: "Audit log", icon: ScrollTextIcon },
];

export const FOOTER_NAV: NavItem[] = [{ href: "/status", label: "System status", icon: ActivityIcon }];

export function NavSection({
  label,
  items,
  onNavigate,
  canApprove = false,
}: {
  label?: string;
  items: NavItem[];
  onNavigate?: () => void;
  canApprove?: boolean;
}) {
  const pathname = usePathname();
  items = items.filter((i) => !i.approversOnly || canApprove);
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="px-4 pt-6 pb-2 font-medium text-ink-muted text-xs uppercase tracking-wider">
          {label}
        </div>
      )}
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-12 items-center gap-3 rounded-lg px-4 text-base outline-none transition-colors md:h-10 md:text-sm md:pointer-coarse:h-12",
              "text-ink-muted hover:bg-ink-hover hover:text-ink-foreground focus-visible:ring-3 focus-visible:ring-ring/60",
              active && "bg-ink-active font-medium text-ink-foreground",
            )}
          >
            {active && (
              <span
                className="-translate-y-1/2 absolute top-1/2 left-0 h-6 w-1 rounded-r-sm bg-primary"
                aria-hidden
              />
            )}
            <item.icon className={cn("size-5 shrink-0", active && "text-ink-accent")} aria-hidden />
            <span className="flex-1">{item.label}</span>
            {item.badge === "attention" && <AttentionCount />}
            {item.badge === "approvals" && <ApprovalsCount />}
            {item.badge === "inbox" && <InboxCount enabled={canApprove} />}
          </Link>
        );
      })}
    </div>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  if (!n) return null;
  return (
    <span className="rounded-md bg-ink-active px-2 font-medium text-ink-foreground text-xs tabular">
      {n}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

function ApprovalsCount() {
  const approvals = useApprovals();
  const n = (approvals.data?.documents.length ?? 0) + (approvals.data?.proposals.length ?? 0);
  return <Count n={n} label="waiting for a decision" />;
}

function InboxCount({ enabled }: { enabled: boolean }) {
  const inbox = useInbox("open", enabled);
  return <Count n={inbox.data?.open_count ?? 0} label="open reports" />;
}

function AttentionCount() {
  const attention = useAttention();
  const n = attention.data?.length ?? 0;
  if (!n) return null;
  return (
    <span className="rounded-md bg-ink-active px-2 font-medium text-ink-foreground text-xs tabular">
      {n}
      <span className="sr-only"> documents need attention</span>
    </span>
  );
}
