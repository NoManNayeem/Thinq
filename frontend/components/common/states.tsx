"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  LockIcon,
  type LucideIcon,
  RefreshCwIcon,
  SearchXIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api/client";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center" data-testid={testId}>
      <span className="flex size-12 items-center justify-center rounded-xl bg-secondary" aria-hidden>
        <Icon className="size-6 text-muted-foreground" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-semibold text-base">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.isForbidden) return <ForbiddenState />;
  if (error instanceof ApiError && error.isNotFound) return <NotFoundState />;
  return (
    <div className="rounded-xl border bg-card" role="alert">
      <EmptyState
        icon={AlertTriangleIcon}
        title="Couldn't load this"
        description={errorMessage(error)}
        action={
          onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCwIcon />
              Try again
            </Button>
          )
        }
      />
    </div>
  );
}

function BackHome() {
  return (
    <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
      <ArrowLeftIcon />
      Back to overview
    </Button>
  );
}

export function ForbiddenState() {
  return (
    <div className="rounded-xl border bg-card">
      <EmptyState
        testId="forbidden"
        icon={LockIcon}
        title="You don't have access to this page"
        description="This area is for Admins. If you need access, ask an Admin in your organization."
        action={<BackHome />}
      />
    </div>
  );
}

export function NotFoundState({ what = "page" }: { what?: string }) {
  return (
    <div className="rounded-xl border bg-card">
      <EmptyState
        icon={SearchXIcon}
        title={`This ${what} doesn't exist`}
        description="It may have been removed, or the link is incorrect."
        action={<BackHome />}
      />
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={r} className="flex items-center gap-4 px-4 py-4 md:px-6">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}
