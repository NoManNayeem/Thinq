import { describe, expect, it } from "vitest";
import { clientAddress } from "./forwarded";

describe("clientAddress", () => {
  it("uses the entry added by the nearest trusted proxy", () => {
    // nginx appends the real client after whatever the client sent
    expect(clientAddress("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    // a CDN then nginx: the client is second from the right
    expect(clientAddress("6.6.6.6, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
    // Caddy replaces the header with the client address
    expect(clientAddress("203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("falls back to the last entry with no proxy, and to nothing when absent", () => {
    expect(clientAddress("198.51.100.4", 0)).toBe("198.51.100.4");
    expect(clientAddress(null, 0)).toBeUndefined();
  });
});
