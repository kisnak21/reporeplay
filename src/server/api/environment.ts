import { parseEnvironment } from "@/lib/environment";
import { RepoReplayError } from "@/server/github/errors";

export function apiEnvironment() {
  try {
    return parseEnvironment(process.env);
  } catch {
    throw new RepoReplayError("SERVICE_UNAVAILABLE", "Repository processing is not configured. Try again later.");
  }
}
