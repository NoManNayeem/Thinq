/** Accept only same-site relative paths as a post-sign-in destination. */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  if (value.startsWith("/sign-in")) return fallback;
  return value;
}
