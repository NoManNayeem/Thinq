import { describe, expect, it } from "vitest";
import { ApiError, toApiError, unwrap } from "./client";

describe("toApiError", () => {
  it("reads the API error envelope", () => {
    const e = toApiError(409, {
      error: { code: "last_admin", message: "Make someone else an Admin first." },
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("last_admin");
    expect(e.message).toBe("Make someone else an Admin first.");
  });

  it("turns validation errors into a readable sentence", () => {
    const e = toApiError(422, {
      detail: [{ loc: ["body", "new_password"], msg: "String should have at least 10 characters" }],
    });
    expect(e.message).toBe("New password: String should have at least 10 characters");
  });

  it("strips pydantic's 'Value error' prefix", () => {
    const e = toApiError(422, {
      detail: [{ loc: ["body", "email"], msg: "Value error, Enter a valid email address." }],
    });
    expect(e.message).toBe("Email: Enter a valid email address.");
  });

  it("explains gateway failures", () => {
    expect(toApiError(502, null).message).toMatch(/temporarily unavailable/);
  });

  it("flags auth states", () => {
    expect(toApiError(401, {}).isUnauthenticated).toBe(true);
    expect(toApiError(403, {}).isForbidden).toBe(true);
    expect(toApiError(404, {}).isNotFound).toBe(true);
  });
});

describe("unwrap", () => {
  it("returns data for successful responses", async () => {
    const data = await unwrap(
      Promise.resolve({ data: { ok: true }, response: new Response(null, { status: 200 }) }),
    );
    expect(data).toEqual({ ok: true });
  });

  it("throws ApiError for failed responses", async () => {
    const promise = unwrap(
      Promise.resolve({
        error: { error: { code: "forbidden", message: "Only Admins can do this." } },
        response: new Response(null, { status: 403 }),
      }),
    );
    await expect(promise).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("maps network failures to a friendly error", async () => {
    await expect(unwrap(Promise.reject(new TypeError("fetch failed")))).rejects.toMatchObject({
      status: 0,
      code: "network",
    });
  });
});
