"use client";

import { Page } from "@/components/common/page";
import { ForbiddenState } from "@/components/common/states";
import { useCurrentUser } from "./current-user";

/**
 * Hides Admin screens from Members. The backend enforces the same rule on every
 * request; this only avoids rendering a screen whose requests would all be refused.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  if (user.role !== "admin") {
    return (
      <Page>
        <ForbiddenState />
      </Page>
    );
  }
  return <>{children}</>;
}
