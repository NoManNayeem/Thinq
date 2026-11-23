"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ComposerHandle = { focus: () => void; fill: (text: string) => void };

/**
 * The prompt box. Enter sends, Shift+Enter adds a line, and text being composed with an
 * input method (e.g. Bangla) is never sent half-way.
 */
export const Composer = forwardRef<
  ComposerHandle,
  { onSend: (text: string) => void; onStop: () => void; busy: boolean; maxChars: number; disabled?: boolean }
>(function Composer({ onSend, onStop, busy, maxChars, disabled = false }, ref) {
  const [value, setValue] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    fill: (text) => {
      setValue(text);
      textarea.current?.focus();
    },
  }));

  const trimmed = value.trim();
  const tooLong = value.length > maxChars;
  const canSend = !busy && !disabled && trimmed.length > 0 && !tooLong;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-4 pb-4 md:px-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
          tooLong && "border-destructive",
        )}
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask a question
        </label>
        <textarea
          id="chat-input"
          ref={textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask about a process, policy or document…"
          disabled={disabled}
          className="field-sizing-content max-h-48 min-h-12 flex-1 resize-none bg-transparent px-2 py-3 text-base outline-none placeholder:text-muted-foreground"
          data-testid="chat-input"
        />
        {busy ? (
          <Button type="button" variant="outline" size="icon" onClick={onStop} aria-label="Stop answering">
            <SquareIcon className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send question">
            <ArrowUpIcon />
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 px-2 text-muted-foreground text-xs">
        <span>
          Thinq only reads documents shared with your groups. Check important answers against the source.
        </span>
        <span className={cn("hidden shrink-0 tabular sm:inline", tooLong && "text-destructive")}>
          {value.length > maxChars * 0.8
            ? `${value.length} / ${maxChars}`
            : "Enter to send · Shift+Enter for a new line"}
        </span>
      </div>
    </form>
  );
});
