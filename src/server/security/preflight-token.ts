import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Environment } from "@/lib/environment";
import { RepoReplayError } from "@/server/github/errors";

const candidateSchema = z.object({
  path: z.string().min(1),
  manifestPath: z.string().min(1),
  routeRoots: z.array(z.string().min(1)).min(1),
  routeFileCount: z.number().int().nonnegative(),
});

export const preflightEvidenceSchema = z.object({
  repository: z.object({
    externalId: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    fullName: z.string().min(1),
    canonicalUrl: z.string().url(),
    defaultBranch: z.string().min(1),
  }),
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  firstParentCommitCount: z.number().int().positive(),
  headFileCount: z.number().int().positive(),
  candidates: z.array(candidateSchema).min(1),
  limits: z.object({
    maxFirstParentCommits: z.number().int().positive(),
    maxHeadFiles: z.number().int().positive(),
  }),
});

export type PreflightEvidence = z.infer<typeof preflightEvidenceSchema>;
const tokenSchema = z.object({ version: z.literal(1), expiresAt: z.number().int(), evidence: preflightEvidenceSchema });

export function signingSecret(environment: Pick<Environment, "PREFLIGHT_SIGNING_SECRET" | "GITHUB_APP_PRIVATE_KEY">): string {
  return environment.PREFLIGHT_SIGNING_SECRET ?? createHmac("sha256", environment.GITHUB_APP_PRIVATE_KEY)
    .update("reporeplay:request-signing:v1").digest("hex");
}

export function signPreflightToken(evidence: PreflightEvidence, options: { secret: string; lifetimeSeconds: number; now?: number }): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    expiresAt: Math.floor((options.now ?? Date.now()) / 1_000) + options.lifetimeSeconds,
    evidence: preflightEvidenceSchema.parse(evidence),
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", options.secret).update(`preflight:${payload}`).digest("base64url")}`;
}

export function verifyPreflightToken(token: string, options: { secret: string; now?: number }): PreflightEvidence {
  const invalid = () => new RepoReplayError("PREFLIGHT_TOKEN_INVALID", "Preflight is invalid. Run the repository check again.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw invalid();
  const [payload, signature] = parts;
  const expected = createHmac("sha256", options.secret).update(`preflight:${payload}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();

  let decoded: z.infer<typeof tokenSchema>;
  try {
    decoded = tokenSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    throw invalid();
  }
  if (decoded.expiresAt <= Math.floor((options.now ?? Date.now()) / 1_000)) {
    throw new RepoReplayError("PREFLIGHT_TOKEN_EXPIRED", "Preflight has expired. Run the repository check again.");
  }
  return decoded.evidence;
}
