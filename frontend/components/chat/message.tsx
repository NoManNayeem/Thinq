"use client";

import { CheckIcon, CopyIcon, EyeOffIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { LogoMark } from "@/components/brand";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatSource } from "@/lib/api/client";
import { dataOf, linkCitations, plainText, retrievalSummary, type ThinqMessage, textOf } from "@/lib/chat";
import { STATUS } from "@/lib/documents";
import { cn } from "@/lib/utils";
import { FeedbackControls } from "./feedback";
import { SourcesPanel, SourcesToggle, sourceAnchor } from "./sources";

function citationComponents(
  messageId: string,
  sources: ChatSource[],
  onCite: (n: number) => void,
): Components {
  return {
    p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="mb-4 flex list-disc flex-col gap-2 pl-6 last:mb-0">{children}</ul>,
    ol: ({ children }) => (
      <ol className="mb-4 flex list-decimal flex-col gap-2 pl-6 last:mb-0">{children}</ol>
    ),
    h1: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
    h2: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
    h3: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
    table: ({ children }) => (
      <div className="mb-4 overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">{children}</table>
      </div>
    ),
    // Answers never load images: a planted instruction could otherwise make the model write an
    // image URL that sends visible text to another server.
    img: ({ alt }) => (alt ? <span className="text-muted-foreground">[{alt}]</span> : null),
    th: ({ children }) => <th className="border-b bg-secondary px-4 py-2 font-medium">{children}</th>,
    td: ({ children }) => <td className="border-b px-4 py-2 align-top">{children}</td>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    a: ({ href, children }) => {
      const match = href?.match(/^#cite-.+-(\d+)$/);
      if (match) {
        const n = Number(match[1]);
        const source = sources.find((s) => s.n === n);
        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={`#${sourceAnchor(messageId, n)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onCite(n);
                  }}
                  className="ml-1 inline-flex h-5 min-w-4 items-center justify-center rounded-md bg-secondary px-1 align-text-bottom font-medium text-muted-foreground text-xs no-underline hover:bg-primary-subtle hover:text-primary"
                  aria-label={source ? `Source ${n}: ${source.title}` : `Source ${n}`}
                  data-testid="citation"
                />
              }
            >
              {children}
            </TooltipTrigger>
            {source && (
              <TooltipContent>
                {source.title} · {STATUS[source.status]?.label ?? source.status}
              </TooltipContent>
            )}
          </Tooltip>
        );
      }
      return (
        <a
          href={href}
          className="text-link underline underline-offset-4"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          {children}
        </a>
      );
    },
  };
}

export function UserMessage({ message, name }: { message: ThinqMessage; name: string }) {
  return (
    <div className="flex justify-end gap-4" data-testid="user-message">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-secondary px-4 py-3 text-base">
        {textOf(message)}
      </div>
      <UserAvatar name={name} size="sm" className="hidden sm:flex" />
    </div>
  );
}

export function AssistantMessage({
  message,
  streaming,
  isLast,
  canRegenerate,
  onRegenerate,
  showRetrieval,
}: {
  message: ThinqMessage;
  streaming: boolean;
  isLast: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  showRetrieval: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Sources stay folded away until the person asks for them (toggle or an inline citation).
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusSource, setFocusSource] = useState<{ n: number } | null>(null);
  const text = textOf(message);
  const sources = dataOf(message, "sources")?.items ?? [];
  const notices = (dataOf(message, "notices")?.items ?? []).filter((n) => n.kind !== "withheld");
  const retrieval = dataOf(message, "retrieval");
  const withheld = message.metadata?.withheld === true;
  const waiting = streaming && !text;
  const panelId = `sources-${message.id}`;
  const openSource = (n: number) => {
    setSourcesOpen(true);
    setFocusSource({ n });
  };
  const candidates = showRetrieval && !streaming ? (retrieval?.candidates ?? []) : [];

  return (
    <article className="group/answer flex gap-4" data-testid="assistant-message" aria-busy={streaming}>
      <LogoMark className="mt-1 hidden size-8 shrink-0 sm:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {withheld ? (
          <div className="flex items-start gap-3 rounded-lg bg-muted p-4 text-sm" data-testid="withheld">
            <EyeOffIcon className="mt-1 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-medium">Answer hidden.</span>{" "}
              <span className="text-muted-foreground">
                It used a document you no longer have access to. Ask again to get an answer from what you can
                see now.
              </span>
            </p>
          </div>
        ) : waiting ? (
          <p className="flex h-8 items-center gap-2 text-muted-foreground text-sm" role="status">
            <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
            {retrieval ? "Writing an answer…" : "Searching documents you can access…"}
          </p>
        ) : (
          <div className="min-w-0 break-words text-base leading-7" data-testid="answer-text">
            <Markdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={citationComponents(message.id, sources, openSource)}
            >
              {linkCitations(text, message.id)}
            </Markdown>
            {streaming && (
              <span
                className="ml-1 inline-block h-4 w-1 animate-pulse bg-foreground align-middle"
                aria-hidden
              />
            )}
          </div>
        )}

        {!withheld && notices.length > 0 && (
          <ul className="flex flex-col gap-1" data-testid="answer-notices">
            {notices.map((n) => (
              <li key={n.kind} className="flex items-start gap-2 text-muted-foreground text-sm">
                <TriangleAlertIcon className="mt-1 size-4 shrink-0 text-warning" aria-hidden />
                <span>{n.message}</span>
              </li>
            ))}
          </ul>
        )}

        {!streaming && (
          <div className="flex flex-wrap items-center gap-2">
            {!withheld && (
              <SourcesToggle
                sources={sources}
                open={sourcesOpen}
                onToggle={() => setSourcesOpen((o) => !o)}
                controls={panelId}
              />
            )}
            <div
              className={cn(
                "flex items-center gap-1 transition-opacity",
                // Older answers keep their actions out of the way until hovered or focused.
                !isLast && "md:opacity-0 md:focus-within:opacity-100 md:group-hover/answer:opacity-100",
              )}
            >
              {!withheld && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copied ? "Copied" : "Copy answer"}
                  onClick={() =>
                    navigator.clipboard?.writeText(plainText(text)).then(() => {
                      setCopied(true);
                      toast.success("Answer copied");
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </Button>
              )}
              {isLast && canRegenerate && (
                <Button variant="ghost" size="icon-sm" aria-label="Regenerate answer" onClick={onRegenerate}>
                  <RefreshCwIcon />
                </Button>
              )}
              {!withheld && (
                <FeedbackControls messageId={message.id} initial={message.metadata?.feedback ?? null} />
              )}
            </div>
            {!withheld && sources.length === 0 && retrieval && (
              <span className="text-muted-foreground text-xs" data-testid="retrieval-summary">
                {retrievalSummary(retrieval)}
              </span>
            )}
          </div>
        )}

        {!withheld && sourcesOpen && sources.length > 0 && (
          <SourcesPanel
            id={panelId}
            messageId={message.id}
            sources={sources}
            focus={focusSource?.n ?? null}
            summary={retrieval ? retrievalSummary(retrieval) : undefined}
          >
            {candidates.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer py-1 font-medium text-muted-foreground">
                  Retrieval details (Admins only)
                </summary>
                <ol className="flex flex-col gap-1 py-2 text-muted-foreground">
                  {candidates.map((c) => (
                    <li key={c.title} className="flex justify-between gap-4">
                      <span className="truncate">
                        {c.title} ({c.status})
                      </span>
                      <span className="tabular">{Math.round(c.relevance * 100)}% match</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </SourcesPanel>
        )}
      </div>
    </article>
  );
}
