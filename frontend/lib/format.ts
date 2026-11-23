import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

/** "3 minutes ago", or a fallback for missing values. */
export function relativeTime(value: string | Date | null | undefined, fallback = "Never") {
  const date = toDate(value);
  if (!date) return fallback;
  if (Math.abs(Date.now() - date.getTime()) < 45_000) return "Just now";
  return `${formatDistanceToNowStrict(date)} ago`;
}

/** "23 Nov 2026, 14:05" */
export function dateTime(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? format(date, "d MMM yyyy, HH:mm") : fallback;
}

/**
 * Up to two initials. Works per grapheme, so names in scripts like Bangla
 * (where one visible letter can be several code points) aren't cut in half.
 */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const first = (word: string) => segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? "";
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return picked
    .map((w) => first(w ?? ""))
    .join("")
    .toLocaleUpperCase();
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
