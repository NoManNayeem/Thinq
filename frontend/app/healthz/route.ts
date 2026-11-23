/** Liveness of the web server itself (used by the container health check). */
export function GET() {
  return Response.json({ status: "ok" });
}
