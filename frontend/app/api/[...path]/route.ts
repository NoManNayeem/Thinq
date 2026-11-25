/**
 * Same-origin gateway to the Thinq API.
 *
 * The browser only ever talks to this server. Requests under /api/* are forwarded to
 * the backend over the internal network, with the body streamed in both directions
 * so Server-Sent Events arrive as they are produced. The backend URL is read at
 * request time, so one image works in every environment.
 */
import type { NextRequest } from "next/server";
import { clientAddress } from "@/lib/forwarded";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function backendUrl() {
  return (process.env.THINQ_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");
}

async function forward(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const search = request.nextUrl.search;
  const target = `${backendUrl()}/api/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  // The client's address. Each trusted proxy appends the address it received the request from,
  // so with N proxies in front (THINQ_TRUSTED_PROXY_HOPS=N) the client is the N-th entry from the
  // right; anything further left was sent by the client and is never believed. With no proxy (0),
  // the last entry is the one Next.js recorded from the socket, unless the client sent its own
  // header; put a reverse proxy in front for exact addresses.
  const clientIp = clientAddress(
    request.headers.get("x-forwarded-for"),
    Number(process.env.THINQ_TRUSTED_PROXY_HOPS ?? "0") || 0,
  );
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  else headers.delete("x-forwarded-for");

  const hasBody = !["GET", "HEAD"].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
      // Required by Node's fetch when streaming a request body.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return Response.json(
      {
        error: {
          code: "backend_unreachable",
          message: "The Thinq API is not reachable.",
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && k !== "content-encoding" && k !== "set-cookie") {
      responseHeaders.set(key, value);
    }
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export {
  forward as DELETE,
  forward as GET,
  forward as HEAD,
  forward as PATCH,
  forward as POST,
  forward as PUT,
};
