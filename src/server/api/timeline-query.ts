import { z } from "zod";
import { commitCategories } from "@/server/contracts/processing";

const dateBound = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const MILLISECONDS_PER_DAY = 86_400_000;
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  query: z.string().trim().max(1_000).default(""),
  category: z.enum(commitCategories).optional(),
  path: z.string().trim().max(4_096).default(""),
  event: z.enum(["ALL", "ROUTE", "DEPENDENCY"]).default("ALL"),
  from: dateBound.optional(),
  to: dateBound.optional(),
}).refine((query) => !query.from || !query.to || new Date(query.from).getTime() <= new Date(query.to).getTime() + (query.to.length === 10 ? MILLISECONDS_PER_DAY - 1 : 0), {
  message: "Start date must be on or before end date.", path: ["to"],
});

export function parseTimelineQuery(params: URLSearchParams) {
  const query = querySchema.parse(Object.fromEntries(params));
  const toExclusive = Boolean(query.to && query.to.length === 10);
  const to = toExclusive ? new Date(new Date(query.to!).getTime() + MILLISECONDS_PER_DAY).toISOString() : query.to;
  return { ...query, to, toExclusive };
}
