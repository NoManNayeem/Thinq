import type { UIMessage } from "ai";
import { isToday, isYesterday, parseISO, subDays } from "date-fns";
import type { ChatFeedback, ChatNotice, ChatSource, Conversation, StoredChatMessage } from "@/lib/api/client";

export type Retrieval = {
  engine?: string;
  model?: string | null;
  semantic?: "off" | "ok" | "unavailable";
  searched?: number;
  used?: number;
  candidates?: Candidate[];
};
export type Candidate = {
  title: string;
  status: string;
  relevance: number;
  lexical?: number;
  semantic?: number | null;
};

/** One line saying how an answer was produced, shown under every answer. */
export function retrievalSummary(r: Retrieval): string {
  const n = r.searched ?? 0;
  const parts = [`Searched ${n} document${n === 1 ? "" : "s"} you can access`];
  if (r.semantic === "ok") parts.push("with the knowledge graph");
  const how =
    r.engine === "preview"
      ? "preview mode"
      : r.engine === "ai"
        ? "written by AI from these sources only. Check the sources before relying on it"
        : null;
  return how ? `${parts.join(" ")} · ${how}` : parts.join(" ");
}

/** Custom data parts streamed by the backend alongside the text. */
export type ChatDataParts = {
  sources: { items: ChatSource[] };
  notices: { items: ChatNotice[] };
  retrieval: Retrieval;
};

export type ChatMetadata = {
  withheld?: boolean;
  feedback?: ChatFeedback | null;
  status?: StoredChatMessage["status"];
  createdAt?: string;
};

export type ThinqMessage = UIMessage<ChatMetadata, ChatDataParts>;

/** Convert a stored message into the chat client's message shape. */
export function toUIMessage(m: StoredChatMessage): ThinqMessage {
  const parts: ThinqMessage["parts"] = [{ type: "text", text: m.content }];
  if (m.role === "assistant") {
    parts.push({ type: "data-sources", id: "sources", data: { items: m.sources } });
    parts.push({ type: "data-notices", id: "notices", data: { items: m.notices } });
    parts.push({ type: "data-retrieval", id: "retrieval", data: m.retrieval as Retrieval });
  }
  return {
    id: m.id,
    role: m.role,
    parts,
    metadata: { withheld: m.withheld, feedback: m.feedback, status: m.status, createdAt: m.created_at },
  };
}

export function textOf(message: ThinqMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function dataOf<K extends keyof ChatDataParts>(
  message: ThinqMessage,
  name: K,
): ChatDataParts[K] | undefined {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i] as { type: string; data?: unknown };
    if (part.type === `data-${name}`) return part.data as ChatDataParts[K];
  }
  return undefined;
}

/** Turn "[2]" markers into links the renderer shows as citation chips. */
export function linkCitations(text: string, messageId: string): string {
  // A line holding only citations (models often put "[1]" after a list) joins the line above,
  // so it doesn't render as a lonely paragraph.
  text = text.replace(/\n+\s*((?:\[\d{1,2}\]\s*)+)\s*(?=\n|$)/g, (_, cites: string) => ` ${cites.trim()}`);
  // The chip carries its own spacing, so the space a model puts before "[1]" is dropped.
  return text.replace(/[ \t]*\[(\d{1,2})\](?!\()/g, (_, n: string) => `[${n}](#cite-${messageId}-${n})`);
}

/** Plain text for copying: citation markers kept, Markdown emphasis removed. */
export function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

export type ConversationGroup = { label: string; items: Conversation[] };

export function groupConversations(items: Conversation[], now = new Date()): ConversationGroup[] {
  const groups: ConversationGroup[] = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  const weekAgo = subDays(now, 7);
  for (const c of items) {
    const d = parseISO(c.updated_at);
    const group = c.pinned
      ? groups[0]
      : isToday(d)
        ? groups[1]
        : isYesterday(d)
          ? groups[2]
          : d > weekAgo
            ? groups[3]
            : groups[4];
    group?.items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}
