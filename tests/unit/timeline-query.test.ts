import { describe, expect, it } from "vitest";
import { parseTimelineQuery } from "../../src/server/api/timeline-query";
import { readTimelineFilters, serializeTimelineFilters } from "../../src/lib/timeline-filters";

describe("timeline filter contract", () => {
  it("round-trips every URL filter including paths with reserved characters", () => {
    const filters = { query: "login & logout", event: "DEPENDENCY", category: "FIX", path: "src/app/[id]/page.tsx", from: "2026-09-01", to: "2026-09-02" };
    expect(readTimelineFilters(new URLSearchParams(serializeTimelineFilters(filters)))).toEqual(filters);
  });

  it("includes the entire final UTC calendar day", () => {
    const query = parseTimelineQuery(new URLSearchParams("from=2026-09-02&to=2026-09-02"));
    expect(query.to).toBe("2026-09-03T00:00:00.000Z");
    expect(query.toExclusive).toBe(true);
  });

  it("preserves exact timestamp bounds", () => {
    const query = parseTimelineQuery(new URLSearchParams("to=2026-09-02T13:20:00Z"));
    expect(query.to).toBe("2026-09-02T13:20:00Z");
    expect(query.toExclusive).toBe(false);
  });

  it.each(["from=2026-02-31", "from=2026-09-03&to=2026-09-02", "limit=NaN", "limit=101", "limit=0", "category=UNKNOWN", "event=unknown"])("rejects invalid query %s", (query) => {
    expect(() => parseTimelineQuery(new URLSearchParams(query))).toThrow();
  });
});
