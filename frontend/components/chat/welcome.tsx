"use client";

import { FlaskConicalIcon, LightbulbIcon, ShieldCheckIcon } from "lucide-react";
import { LogoMark } from "@/components/brand";
import { Callout } from "@/components/common/page";
import type { ChatConfig } from "@/lib/api/client";

export function ChatWelcome({
  firstName,
  config,
  onPick,
}: {
  firstName: string;
  config: ChatConfig | undefined;
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-8 py-8 text-center md:py-16" data-testid="chat-welcome">
      <LogoMark className="size-12" />
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-xl tracking-tight">What do you need to know, {firstName}?</h2>
        <p className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <ShieldCheckIcon className="size-4" aria-hidden />
          Answers only use documents shared with {config ? config.answering_from.join(", ") : "your groups"}.
        </p>
      </div>
      {config && config.suggestions.length > 0 && (
        <ul className="grid w-full max-w-2xl gap-2 text-left sm:grid-cols-2" aria-label="Suggested questions">
          {config.suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex min-h-12 w-full items-start gap-2 rounded-lg border bg-card px-4 py-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <LightbulbIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      {config?.engine === "preview" && (
        <div className="w-full max-w-2xl text-left">
          <Callout icon={FlaskConicalIcon}>
            <span className="font-medium text-foreground">Preview mode.</span> No AI model is connected yet,
            so answers list the most relevant excerpts from documents you can access, with their sources.
          </Callout>
        </div>
      )}
    </div>
  );
}
