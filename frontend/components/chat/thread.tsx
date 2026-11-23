"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { ArrowDownIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/client";
import { keys, useChatConfig, useCreateConversation } from "@/lib/api/queries";
import { type ThinqMessage, textOf } from "@/lib/chat";
import { Composer, type ComposerHandle } from "./composer";
import { AssistantMessage, UserMessage } from "./message";
import { ChatWelcome } from "./welcome";

function JumpToLatest() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <div className="-translate-x-1/2 pointer-events-none absolute bottom-4 left-1/2">
      <Button
        variant="outline"
        className="pointer-events-auto rounded-full shadow-md"
        onClick={() => scrollToBottom()}
      >
        <ArrowDownIcon />
        Jump to latest
      </Button>
    </div>
  );
}

/**
 * One conversation. New chats are created on the first question, and the URL is updated in
 * place so the stream isn't interrupted.
 */
export function ChatThread({
  conversationId,
  initialMessages,
  onCreated,
}: {
  conversationId: string | null;
  initialMessages: ThinqMessage[];
  onCreated: (id: string) => void;
}) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const config = useChatConfig();
  const create = useCreateConversation();
  const idRef = useRef<string | null>(conversationId);
  const composer = useRef<ComposerHandle>(null);
  const [chatKey] = useState(() => conversationId ?? `draft-${crypto.randomUUID()}`);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ThinqMessage>({
        api: "/api/chat/conversations",
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          return {
            api: `/api/chat/conversations/${idRef.current}/messages`,
            body: { text: trigger === "submit-message" && lastUser ? textOf(lastUser) : "", trigger },
          };
        },
      }),
  );

  const chat = useChat<ThinqMessage>({
    id: chatKey,
    messages: initialMessages,
    transport,
    throttle: 50,
    onFinish: () => {
      qc.invalidateQueries({ queryKey: keys.conversations });
      if (idRef.current) qc.removeQueries({ queryKey: keys.conversation(idRef.current) });
    },
  });

  const busy = chat.status === "submitted" || chat.status === "streaming";

  const send = async (text: string) => {
    try {
      if (!idRef.current) {
        const created = await create.mutateAsync();
        idRef.current = created.id;
        onCreated(created.id); // before the URL changes: see ChatScreen
        window.history.replaceState(null, "", `/chat?c=${created.id}`);
      }
      chat.clearError();
      await chat.sendMessage({ text });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const firstName = user.name.split(" ")[0] ?? user.name;
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StickToBottom className="relative min-h-0 flex-1 overflow-y-auto" resize="smooth" initial="instant">
        <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-8">
          {chat.messages.length === 0 ? (
            <ChatWelcome firstName={firstName} config={config.data} onPick={(s) => void send(s)} />
          ) : (
            chat.messages.map((m, i) =>
              m.role === "user" ? (
                <UserMessage key={m.id} message={m} name={user.name} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  streaming={busy && i === chat.messages.length - 1}
                  isLast={m.id === lastAssistant?.id}
                  canRegenerate={!busy}
                  onRegenerate={() => void chat.regenerate()}
                  showRetrieval={user.role === "admin"}
                />
              ),
            )
          )}
          {chat.status === "submitted" && chat.messages.at(-1)?.role === "user" && (
            <p className="flex items-center gap-2 pl-12 text-muted-foreground text-sm" role="status">
              <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
              Searching documents you can access…
            </p>
          )}
          {chat.error && (
            <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-sm" role="alert">
              <TriangleAlertIcon className="mt-1 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="flex flex-1 flex-col gap-2">
                <p>Thinq couldn&apos;t answer that. Check your connection and try again.</p>
                <div>
                  <Button variant="outline" size="sm" onClick={() => void chat.regenerate()}>
                    <RefreshCwIcon />
                    Try again
                  </Button>
                </div>
              </div>
            </div>
          )}
        </StickToBottom.Content>
        <JumpToLatest />
      </StickToBottom>
      <div className="border-t bg-background">
        <Composer
          ref={composer}
          onSend={(text) => void send(text)}
          onStop={() => void chat.stop()}
          busy={busy || create.isPending}
          maxChars={config.data?.max_question_chars ?? 4000}
        />
      </div>
    </div>
  );
}
