import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export function createWorkerId(configuredId?: string): string {
  const normalized = configuredId?.trim();
  return normalized || `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
}
