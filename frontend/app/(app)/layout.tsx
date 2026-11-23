import { Suspense } from "react";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";

/**
 * Everything behind sign-in is per-user, so it renders on the client after the
 * session is checked. The skeleton is the static shell served instantly.
 */
export default function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
