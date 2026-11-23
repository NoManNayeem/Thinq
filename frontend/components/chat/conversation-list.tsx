"use client";

import {
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconInput } from "@/components/common/inputs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type Conversation, errorMessage } from "@/lib/api/client";
import { useConversations, useDeleteConversation, useUpdateConversation } from "@/lib/api/queries";
import { groupConversations } from "@/lib/chat";
import { cn } from "@/lib/utils";

export function ConversationList({
  activeId,
  onNew,
  onNavigate,
  onDeleted,
}: {
  activeId: string | null;
  onNew: () => void;
  onNavigate?: () => void;
  onDeleted: (id: string) => void;
}) {
  const conversations = useConversations();
  const update = useUpdateConversation();
  const remove = useDeleteConversation();
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const needle = q.trim().toLocaleLowerCase();
  const items = (conversations.data ?? []).filter(
    (c) => !needle || c.title.toLocaleLowerCase().includes(needle),
  );
  const groups = groupConversations(items);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="conversation-list">
      <div className="flex flex-col gap-2 border-b p-4">
        <Button variant="outline" onClick={onNew} className="w-full justify-start">
          <PlusIcon />
          New chat
        </Button>
        <IconInput
          icon={SearchIcon}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </div>
      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.isPending ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <p className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground text-sm">
            <MessageSquareIcon className="size-5" aria-hidden />
            {needle ? "No chats match." : "Your chats will appear here."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-4">
              <h3 className="px-2 pb-1 font-medium text-muted-foreground text-xs">{g.label}</h3>
              <ul className="flex flex-col gap-1">
                {g.items.map((c) => (
                  <li key={c.id} className="group relative">
                    <Link
                      href={`/chat?c=${c.id}` as Route}
                      onClick={onNavigate}
                      aria-current={c.id === activeId ? "page" : undefined}
                      className={cn(
                        "flex h-12 items-center gap-2 rounded-lg pr-12 pl-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 md:h-10",
                        c.id === activeId && "bg-secondary font-medium",
                      )}
                      data-testid="conversation-link"
                    >
                      {c.pinned && (
                        <PinIcon className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />
                      )}
                      <span className="truncate">{c.title}</span>
                    </Link>
                    <div
                      className={cn(
                        "-translate-y-1/2 absolute top-1/2 right-1 transition-opacity",
                        // Quiet list: the menu appears on hover/focus, for the open chat, and on touch.
                        c.id !== activeId &&
                          "opacity-0 focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100",
                      )}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon-sm" aria-label={`Options for ${c.title}`} />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => update.mutate({ id: c.id, pinned: !c.pinned })}>
                            {c.pinned ? <PinOffIcon /> : <PinIcon />}
                            {c.pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setTitle(c.title);
                              setRenaming(c);
                            }}
                          >
                            <PencilIcon />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(c)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Only you can see your chats.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming || !title.trim() || update.isPending) return;
              update.mutate(
                { id: renaming.id, title: title.trim() },
                { onSuccess: () => setRenaming(null), onError: (err) => toast.error(errorMessage(err)) },
              );
            }}
          >
            <Input
              aria-label="Chat name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || update.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this chat?"
        description={`“${deleting?.title ?? ""}” and its answers will be permanently deleted.`}
        confirmLabel="Delete chat"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Chat deleted");
              onDeleted(deleting.id);
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}
