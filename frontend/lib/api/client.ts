import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];
export type User = Schemas["UserOut"];
export type UserDetail = Schemas["UserDetailOut"];
export type Me = Schemas["MeOut"];
export type GroupRef = Schemas["GroupRef"];
export type Group = Schemas["GroupOut"];
export type GroupDetail = Schemas["GroupDetailOut"];
export type GroupMember = Schemas["GroupMemberOut"];
export type AuditEvent = Schemas["AuditEventOut"];
export type DemoUser = Schemas["DemoUserOut"];
export type Health = Schemas["HealthOut"];
export type Role = User["role"];
export type DocumentSummary = Schemas["DocumentSummary"];
export type DocumentDetail = Schemas["DocumentDetail"];
export type DocumentFlag = Schemas["FlagOut"];
export type DocumentStatus = DocumentSummary["status"];
export type DocumentVersion = Schemas["VersionOut"];
export type AttentionItem = Schemas["AttentionItem"];
export type DocumentScan = Schemas["ScanOut"];

/**
 * Same-origin client. The browser talks only to the Next.js server, which forwards
 * /api/* to the backend, so the session cookie is never exposed to another origin.
 */
export const api = createClient<paths>({
  baseUrl: "",
  credentials: "same-origin",
  headers: { Accept: "application/json" },
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthenticated() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }
}

type ValidationItem = { loc?: (string | number)[]; msg?: string };

/** Turn any error body the API can return into a readable message. */
export function toApiError(status: number, body: unknown): ApiError {
  if (body && typeof body === "object") {
    const b = body as {
      error?: { code?: string; message?: string };
      detail?: unknown;
    };
    if (b.error?.message) {
      return new ApiError(status, b.error.code ?? "error", b.error.message);
    }
    if (Array.isArray(b.detail) && b.detail.length > 0) {
      const first = b.detail[0] as ValidationItem;
      const field = first.loc?.filter((p) => p !== "body").join(".");
      const msg = (first.msg ?? "Invalid value").replace(/^Value error, /, "");
      return new ApiError(status, "validation_error", field ? `${humanize(field)}: ${msg}` : msg);
    }
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError(status, "unavailable", "Thinq is temporarily unavailable. Try again shortly.");
  }
  return new ApiError(status, "error", "Something went wrong. Please try again.");
}

function humanize(field: string) {
  const text = field.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/** Resolve an openapi-fetch result to its data, or throw an ApiError. */
export async function unwrap<T>(promise: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await promise;
  } catch {
    throw new ApiError(0, "network", "Can't reach Thinq. Check your connection and try again.");
  }
  if (!result.response.ok) {
    throw toApiError(result.response.status, result.error);
  }
  return result.data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
