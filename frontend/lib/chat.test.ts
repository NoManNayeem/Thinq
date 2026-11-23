import { describe, expect, it } from "vitest";
import type { Conversation, StoredChatMessage } from "./api/client";
import { dataOf, groupConversations, linkCitations, plainText, textOf, toUIMessage } from "./chat";

const conv = (id: string, updated_at: string, pinned = false): Conversation => ({
  id,
  title: id,
  pinned,
  created_at: updated_at,
  updated_at,
});

describe("chat helpers", () => {
  it("links citation markers to their sources", () => {
    expect(linkCitations("See **A** [1] and [2].", "m1")).toBe(
      "See **A**[1](#cite-m1-1) and[2](#cite-m1-2).",
    );
    expect(linkCitations("Already [1](#x)", "m1")).toBe("Already [1](#x)");
  });

  it("strips emphasis for copying", () => {
    expect(plainText("**Travel Policy v2** (Approved) [1]")).toBe("Travel Policy v2 (Approved) [1]");
  });

  it("maps stored answers with their sources", () => {
    const stored: StoredChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Answer [1]",
      status: "complete",
      created_at: "2026-11-24T10:00:00Z",
      withheld: false,
      sources: [
        {
          n: 1,
          document_id: "d1",
          title: "Doc",
          status: "approved",
          owner_name: "Alex",
          last_reviewed: null,
          access_group: "Everyone",
          access_group_is_system: true,
          excerpt: "x",
          version: 1,
        },
      ],
      notices: [{ kind: "draft", message: "Includes a draft" }],
      retrieval: { engine: "preview", searched: 3, used: 1 },
      feedback: null,
    };
    const ui = toUIMessage(stored);
    expect(textOf(ui)).toBe("Answer [1]");
    expect(dataOf(ui, "sources")?.items[0]?.title).toBe("Doc");
    expect(dataOf(ui, "notices")?.items).toHaveLength(1);
    expect(ui.metadata?.withheld).toBe(false);
  });

  it("groups conversations by recency, pinned first", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const groups = groupConversations(
      [
        conv("pinned", "2026-01-01T00:00:00Z", true),
        conv("today", "2026-11-24T09:00:00Z"),
        conv("yesterday", "2026-11-23T09:00:00Z"),
        conv("week", "2026-11-20T09:00:00Z"),
        conv("old", "2026-10-01T09:00:00Z"),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Pinned", ["pinned"]],
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ]);
  });
});

describe("retrievalSummary", () => {
  it("says how an answer was produced", async () => {
    const { retrievalSummary } = await import("./chat");
    expect(retrievalSummary({ engine: "preview", searched: 1 })).toBe(
      "Searched 1 document you can access · preview mode",
    );
    expect(retrievalSummary({ engine: "ai", searched: 9, semantic: "ok" })).toContain(
      "with the knowledge graph · written by AI from these sources only",
    );
  });
});

describe("linkCitations layout", () => {
  it("joins a citation-only line onto the line above", async () => {
    const { linkCitations } = await import("./chat");
    const out = linkCitations("- one\n- two\n\n[1]", "m");
    expect(out).toBe("- one\n- two[1](#cite-m-1)");
    expect(linkCitations("Net 45 [1].\n\nMore.", "m")).toBe("Net 45[1](#cite-m-1).\n\nMore.");
  });
});
