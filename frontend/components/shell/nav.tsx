"use client";

import {
  ActivityIcon,
  FlagIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  type LucideIcon,
  ScrollTextIcon,
  UserCircleIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAttention } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

type NavItem = { href: Route; label: string; icon: LucideIcon; exact?: boolean; badge?: "attention" };

export const WORKSPACE_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon, exact: true },
  { href: "/library", label: "Library", icon: LibraryIcon },
  { href: "/profile", label: "Your profile", icon: UserCircleIcon },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/attention", label: "Needs attention", icon: FlagIcon, badge: "attention" },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/groups", label: "Groups", icon: UsersRoundIcon },
  { href: "/admin/audit", label: "Audit log", icon: ScrollTextIcon },
];

export const FOOTER_NAV: NavItem[] = [{ href: "/status", label: "System status", icon: ActivityIcon }];

export function NavSection({
  label,
  items,
  onNavigate,
}: {
  label?: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
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
          </Link>
        );
      })}
    </div>
  );
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
