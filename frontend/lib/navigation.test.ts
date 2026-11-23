import { describe, expect, it } from "vitest";
import { safeNext } from "./navigation";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/admin/users?q=a")).toBe("/admin/users?q=a");
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["absolute URL", "https://evil.example/phish"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["relative path", "admin"],
    ["sign-in loop", "/sign-in?next=/"],
  ])("rejects %s", (_, value) => {
    expect(safeNext(value)).toBe("/");
  });
});
