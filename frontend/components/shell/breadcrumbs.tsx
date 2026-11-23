"use client";

import { ChevronRightIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

type Crumb = { label: string; href?: Route };

/** Breadcrumbs derived from the URL, so every screen gets the same, predictable trail. */
export function crumbsFor(pathname: string): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [{ label: "Overview" }];
  if (parts[0] === "profile") return [{ label: "Your profile" }];
  if (parts[0] === "admin") {
    const section = parts[1];
    const labels: Record<string, string> = { users: "Users", groups: "Groups", audit: "Audit log" };
    const detail: Record<string, string> = { users: "User details", groups: "Group details" };
    const crumbs: Crumb[] = [{ label: "Administration" }];
    if (section && labels[section]) {
      crumbs.push(
        parts[2]
          ? { label: labels[section], href: `/admin/${section}` as Route }
          : { label: labels[section] },
      );
      if (parts[2] && detail[section]) crumbs.push({ label: detail[section] });
    }
    return crumbs;
  }
  return [];
}

export function Breadcrumbs() {
  const crumbs = crumbsFor(usePathname());
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-2 text-sm">
        {crumbs.map((c, i) => (
          <Fragment key={c.label}>
            {i > 0 && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <li className="min-w-0 truncate">
              {c.href ? (
                <Link
                  href={c.href}
                  className="rounded-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={
                    i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
                  }
                >
                  {c.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
