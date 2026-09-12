import { commitCategories } from "@/server/contracts/processing";

export interface TimelineFilters {
  query: string;
  event: string;
  category: string;
  path: string;
  from: string;
  to: string;
}

export const EMPTY_TIMELINE_FILTERS: TimelineFilters = { query: "", event: "ALL", category: "ALL", path: "", from: "", to: "" };

export function readTimelineFilters(params: Pick<URLSearchParams, "get">): TimelineFilters {
  const category = params.get("category") ?? "ALL";
  const event = params.get("event") ?? "ALL";
  return {
    query: params.get("query") ?? "",
    event: ["ROUTE", "DEPENDENCY"].includes(event) ? event : "ALL",
    category: (commitCategories as readonly string[]).includes(category) ? category : "ALL",
    path: params.get("path") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}

export function serializeTimelineFilters(filters: TimelineFilters): string {
  const params = new URLSearchParams();
  for (const key of ["query", "event", "category", "path", "from", "to"] as const) {
    const value = filters[key];
    if (value && !((key === "event" || key === "category") && value === "ALL")) params.set(key, value);
  }
  return params.toString();
}
