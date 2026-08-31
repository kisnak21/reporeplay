import type { ErrorCode } from "@/server/contracts/errors";

export class RepoReplayError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "RepoReplayError";
  }
}
