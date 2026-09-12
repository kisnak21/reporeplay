import { afterEach, describe, expect, it, vi } from "vitest";
import { createMutationRequest } from "../../src/lib/idempotent-request";

afterEach(() => vi.unstubAllGlobals());

describe("client mutation replay", () => {
  it("reuses a key after a lost response and rotates it after success", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Connection interrupted"))
      .mockImplementation(async () => Response.json({ data: { queued: true } }));
    vi.stubGlobal("fetch", fetch);
    const mutate = createMutationRequest();
    await expect(mutate("/api/repositories", { body: "one" })).rejects.toThrow("interrupted");
    await mutate("/api/repositories", { body: "one" });
    await mutate("/api/repositories", { body: "one" });
    const keys = fetch.mock.calls.map((call) => new Headers(call[1].headers).get("Idempotency-Key"));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
