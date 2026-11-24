"use client";

import { MenuIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/api/queries";
import { Breadcrumbs } from "./breadcrumbs";
import { CurrentUserProvider } from "./current-user";
import { ADMIN_NAV, FOOTER_NAV, NavSection, WORKSPACE_NAV } from "./nav";
import { GlobalProgress, OfflineBanner } from "./network-feedback";
import { UserMenu } from "./user-menu";

function SidebarContent({
  isAdmin,
  canApprove,
  onNavigate,
}: {
  isAdmin: boolean;
  canApprove: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-ink text-ink-foreground">
      <div className="flex h-16 shrink-0 items-center px-6">
        <Logo tone="ink" />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-4 pt-4">
        <NavSection items={WORKSPACE_NAV} onNavigate={onNavigate} canApprove={canApprove} />
        {isAdmin && <NavSection label="Administration" items={ADMIN_NAV} onNavigate={onNavigate} />}
      </nav>
      <div className="border-ink-border border-t px-4 py-4">
        <NavSection items={FOOTER_NAV} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh" role="status" aria-busy="true" aria-label="Loading Thinq">
      <div className="hidden w-64 shrink-0 bg-ink lg:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-16 border-b bg-background" />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 md:px-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="mt-4 h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unauthenticated = me.error instanceof ApiError && me.error.isUnauthenticated;

  useEffect(() => {
    if (unauthenticated) {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/sign-in${next}` as "/sign-in");
    }
  }, [unauthenticated, pathname, router]);

  if (me.isPending || unauthenticated) return <ShellSkeleton />;
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }

  const isAdmin = me.data.user.role === "admin";
  const canApprove = isAdmin || Boolean(me.data.owns_documents);

  return (
    <CurrentUserProvider value={me.data}>
      <GlobalProgress />
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-background px-4 py-3 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <div className="flex min-h-svh">
        <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block" aria-label="Sidebar">
          <SidebarContent isAdmin={isAdmin} canApprove={canApprove} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger
                  render={
                    <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />
                  }
                >
                  <MenuIcon className="size-5" />
                </SheetTrigger>
                <SheetContent side="left" className="w-72 border-none p-0" showCloseButton={false}>
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <SidebarContent
                    isAdmin={isAdmin}
                    canApprove={canApprove}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </SheetContent>
              </Sheet>
              <span className="lg:hidden">
                <Logo />
              </span>
              <Breadcrumbs />
            </div>
            <UserMenu />
          </header>
          <OfflineBanner />
          <main id="main" className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </CurrentUserProvider>
  );
}
