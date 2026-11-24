import { describe, expect, it } from "vitest";
import { greeting, initials, plural, relativeTime } from "./format";

describe("format helpers", () => {
  it("builds initials", () => {
    expect(initials("Nora Reyes")).toBe("NR");
    expect(initials("Ravi")).toBe("R");
    expect(initials("  Mary Ann  Smith ")).toBe("MS");
    expect(initials("")).toBe("?");
  });

  it("describes relative times", () => {
    expect(relativeTime(null)).toBe("Never");
    expect(relativeTime(new Date())).toBe("Just now");
    expect(relativeTime(new Date(Date.now() - 3 * 60_000))).toBe("3 minutes ago");
  });

  it("greets by time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe("Good morning");
    expect(greeting(new Date(2026, 0, 1, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 0, 1, 21))).toBe("Good evening");
  });

  it("pluralises", () => {
    expect(plural(1, "member")).toBe("1 member");
    expect(plural(3, "person", "people")).toBe("3 people");
  });
});

describe("initials for mixed scripts", () => {
  it("keeps whole Bangla letters", () => {
    // "না" is one visible letter (consonant + vowel sign) and must stay whole.
    expect(initials("নাদিয়া রহমান")).toBe("নার");
    // Never end on a dangling virama (্), which would render as a broken glyph.
    expect(initials("প্রিয়া")).not.toMatch(/\u09CD$/);
    expect(initials("Nora রহমান")).toBe("Nর");
  });
});
