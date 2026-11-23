"use client";

import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useOnline } from "@/hooks/use-online";

/**
 * A thin bar at the very top while any request is in flight. It appears only
 * after a short delay, so fast responses don't flicker but slow ones are visible.
 */
export function GlobalProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const id = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(id);
  }, [busy]);
  if (!visible) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] h-1 overflow-hidden bg-primary/15"
      role="progressbar"
      aria-label="Loading"
      data-testid="global-progress"
    >
      <div className="thinq-progress-bar h-full w-1/4 bg-primary" />
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-warning/30 border-b bg-warning/10 px-4 py-3 text-sm md:px-8"
    >
      <WifiOffIcon className="size-4 shrink-0 text-warning" aria-hidden />
      <span>
        <span className="font-medium">You&apos;re offline.</span> Changes won&apos;t be saved until your
        connection is back.
      </span>
    </div>
  );
}
