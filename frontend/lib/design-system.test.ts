/**
 * Guards the design system rules so they can't erode one class name at a time:
 * - spacing stays on the 4-point grid (whole Tailwind steps only)
 * - only the three agreed font weights
 * - no ad-hoc font sizes
 * - at most two font families
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const DIRS = ["app", "components", "lib", "hooks"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const files = DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

function violations(pattern: RegExp) {
  return files.flatMap(({ path, text }) =>
    text
      .split("\n")
      .flatMap((line, i) => [...line.matchAll(pattern)].map((m) => `${path}:${i + 1}  ${m[0]}`)),
  );
}

const SPACING =
  "(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|left|right|bottom)";

describe("design system", () => {
  it("found the source files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("keeps spacing on the 4-point grid", () => {
    // e.g. p-2.5 (10px), gap-1.5 (6px), mt-px, px-[13px]
    const offGrid = new RegExp(`(?<![\\w/-])-?${SPACING}-(?:\\d+\\.\\d+|px|\\[[^\\]]+\\])(?![\\w.])`, "g");
    expect(violations(offGrid)).toEqual([]);
  });

  it("uses only regular, medium and semibold weights", () => {
    expect(violations(/\bfont-(?:thin|extralight|light|bold|extrabold|black)\b/g)).toEqual([]);
  });

  it("uses only the type scale", () => {
    expect(violations(/\btext-\[\d[^\]]*\]/g)).toEqual([]);
    expect(violations(/\btext-(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g)).toEqual([]);
  });

  it("loads exactly two font families", () => {
    const layout = files.find((f) => f.path === "app/layout.tsx")?.text ?? "";
    const fonts = [...layout.matchAll(/import "@fontsource[^"]+"/g)].map((m) => m[0]);
    expect(fonts).toEqual([
      'import "@fontsource-variable/inter"',
      'import "@fontsource-variable/noto-sans-bengali"',
    ]);
    expect(violations(/\bfont-serif\b/g)).toEqual([]);
  });
});
