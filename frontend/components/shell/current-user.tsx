"use client";

import { createContext, useContext } from "react";
import type { Me } from "@/lib/api/client";

const CurrentUserContext = createContext<Me | null>(null);

export const CurrentUserProvider = CurrentUserContext.Provider;

/** The signed-in user. Only available inside the authenticated app shell. */
export function useCurrentUser(): Me {
  const me = useContext(CurrentUserContext);
  if (!me) throw new Error("useCurrentUser must be used inside <AppShell>");
  return me;
}
