/**
 * The client's address from an X-Forwarded-For header. Each trusted proxy appends the address it
 * received the request from, so with `hops` proxies in front the client is the hops-th entry from
 * the right; entries further left were sent by the client and are never believed. With no proxy
 * (0) the last entry is used: the one Next.js recorded from the socket when the client sent none.
 */
export function clientAddress(header: string | null, hops: number): string | undefined {
  const chain = (header ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return chain[Math.max(0, chain.length - Math.max(1, hops))];
}
