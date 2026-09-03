import { describe, expect, it } from "vitest";
import { decodeTimelineCursor, encodeTimelineCursor } from "../../src/server/api/timeline-cursor";

describe("timeline cursor", () => {
  it("round-trips run id and sequence", () => {
    const cursor = encodeTimelineCursor("run-123", 42);
    expect(decodeTimelineCursor(cursor)).toEqual({ runId: "run-123", sequence: 42 });
  });

  it("binds the cursor to a single active run", () => {
    const cursor = encodeTimelineCursor("run-abc", 7);
    const decoded = decodeTimelineCursor(cursor);
    expect(decoded?.runId).toBe("run-abc");
    expect(decoded?.runId).not.toBe("run-def");
  });

  it("rejects malformed cursors", () => {
    expect(decodeTimelineCursor("not-a-cursor")).toBeNull();
    expect(decodeTimelineCursor("")).toBeNull();
  });

  it("rejects legacy sequence-only cursors", () => {
    const legacy = Buffer.from("42").toString("base64url");
    expect(decodeTimelineCursor(legacy)).toBeNull();
  });
});
