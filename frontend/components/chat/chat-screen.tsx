"use client";

import { HistoryIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/common/states";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversation, useConversations } from "@/lib/api/queries";
import { toUIMessage } from "@/lib/chat";
import { ConversationList } from "./conversation-list";
import { ChatThread } from "./thread";

export function ChatScreen() {
  // The chat id lives in the query string: changing it never remounts the page, so a chat
  // created on the first question keeps streaming while the URL updates.
  const routeId = useSearchParams().get("c");
  const router = useRouter();
  const { user } = useCurrentUser();
  const conversations = useConversations();
  const [historyOpen, setHistoryOpen] = useState(false);
  // The thread on screen. A chat created in place keeps its thread (and its live stream).
  const [thread, setThread] = useState<{ key: string; id: string | null }>({
    key: routeId ?? "new",
    id: routeId,
  });

  // Follow the URL only when the URL itself changes (history, links, "New chat"). A chat created
  // on the first question sets its own id first and the URL a moment later; neither step may
  // remount the thread, or the question being answered is lost.
  const createdInPlace = useRef<string | null>(null);
  const lastRouteId = useRef(routeId);
  useEffect(() => {
    if (routeId === lastRouteId.current) return;
    lastRouteId.current = routeId;
    if (routeId !== null && routeId === createdInPlace.current) return; // our own URL update
    setThread({ key: routeId ?? `new-${Date.now()}`, id: routeId });
  }, [routeId]);

  const detail = useConversation(thread.key.startsWith("new") ? null : thread.id);
  const title = conversations.data?.find((c) => c.id === thread.id)?.title ?? "New chat";

  const startNew = () => {
    setHistoryOpen(false);
    setThread({ key: `new-${Date.now()}`, id: null });
    router.push("/chat" as Route);
  };

  const list = (
    <ConversationList
      activeId={thread.id}
      onNew={startNew}
      onNavigate={() => setHistoryOpen(false)}
      onDeleted={(id) => id === thread.id && startNew()}
    />
  );

  const loadingExisting = thread.id !== null && !thread.key.startsWith("new") && detail.isPending;

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0">
      <aside className="hidden w-72 shrink-0 border-r bg-background lg:block" aria-label="Chats">
        {list}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b bg-background px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Chat history" />
                }
              >
                <HistoryIcon />
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0" showCloseButton={false}>
                <SheetTitle className="sr-only">Chat history</SheetTitle>
                {list}
              </SheetContent>
            </Sheet>
            <h1 className="truncate font-semibold text-base" data-testid="chat-title">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="hidden h-8 items-center gap-2 rounded-md border px-3 text-muted-foreground text-xs md:inline-flex"
                    data-testid="answering-from"
                  />
                }
              >
                <ShieldCheckIcon className="size-4" aria-hidden />
                {user.groups.map((g) => g.name).join(" · ")}
              </TooltipTrigger>
              <TooltipContent>Answers only use documents shared with these groups</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="New chat"
              onClick={startNew}
            >
              <PlusIcon />
            </Button>
          </div>
        </header>

        {loadingExisting ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
            <Skeleton className="ml-auto h-12 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : detail.isError ? (
          <div className="mx-auto w-full max-w-3xl p-8">
            <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
          </div>
        ) : (
          <ChatThread
            key={thread.key}
            conversationId={thread.id}
            initialMessages={(detail.data?.messages ?? []).map(toUIMessage)}
            onCreated={(id) => {
              createdInPlace.current = id;
              setThread((t) => ({ ...t, id }));
            }}
          />
        )}
      </section>
    </div>
  );
}
