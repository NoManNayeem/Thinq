import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./api/client";
import { auditDescription, auditLabel, auditTone } from "./audit";

const event = (action: string, details: Record<string, unknown> = {}): AuditEvent => ({
  id: 1,
  action,
  details,
  occurred_at: "2026-11-23T10:00:00Z",
  actor_id: null,
  actor_label: "tariq@example.com",
  target_id: null,
  target_label: "priya@example.com",
  target_type: "user",
  ip_address: null,
});

describe("audit presentation", () => {
  it("labels known actions and falls back to the raw action", () => {
    expect(auditLabel("membership.removed")).toBe("Removed from group");
    expect(auditLabel("something.new")).toBe("something.new");
  });

  it("describes changes", () => {
    expect(auditDescription(event("membership.removed", { group: "Finance" }))).toBe("Finance");
    expect(auditDescription(event("user.role_changed", { from: "member", to: "admin" }))).toBe(
      "member → admin",
    );
  });

  it("highlights risky events", () => {
    expect(auditTone("auth.login_failed")).toBe("destructive");
    expect(auditTone("membership.removed")).toBe("warning");
    expect(auditTone("membership.added")).toBe("success");
  });
});
