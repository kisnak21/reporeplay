import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { PoolClient } from "pg";
import type { Environment } from "@/lib/environment";
import { RepoReplayError } from "@/server/github/errors";
import { signingSecret } from "./preflight-token";

export const DEFAULT_GLOBAL_PENDING_RUNS = 20;
export const DEFAULT_GLOBAL_RUNNING_JOBS = 4;

export function requestSubject(request: Request, environment: Environment): string {
  const address = environment.TRUSTED_CLIENT_IP_HEADER ? request.headers.get(environment.TRUSTED_CLIENT_IP_HEADER)?.trim() : null;
  let subject = "unattributed";
  if (address && isIP(address)) {
    subject = isIP(address) === 6 ? new URL(`http://[${address}]`).hostname : address;
  }
  return createHmac("sha256", signingSecret(environment)).update(`import-ip:${subject}`).digest("hex");
}

export async function consumeImportQuota(client: PoolClient, input: { subjectHash: string; maximum: number; windowSeconds: number }): Promise<void> {
  const result = await client.query<{ resetsAt: Date }>(
    `INSERT INTO "ImportRateWindow"("subjectHash","count","resetsAt")
     VALUES($1,1,CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'))
     ON CONFLICT("subjectHash") DO UPDATE
     SET "count"=CASE WHEN "ImportRateWindow"."resetsAt"<=CURRENT_TIMESTAMP THEN 1 ELSE "ImportRateWindow"."count"+1 END,
         "resetsAt"=CASE WHEN "ImportRateWindow"."resetsAt"<=CURRENT_TIMESTAMP THEN EXCLUDED."resetsAt" ELSE "ImportRateWindow"."resetsAt" END
     WHERE "ImportRateWindow"."resetsAt"<=CURRENT_TIMESTAMP OR "ImportRateWindow"."count"<$2
     RETURNING "resetsAt"`,
    [input.subjectHash, input.maximum, input.windowSeconds],
  );
  if (result.rowCount) return;
  const window = await client.query<{ retryAfterSeconds: number }>(
    `SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM ("resetsAt"-CURRENT_TIMESTAMP))))::int AS "retryAfterSeconds"
     FROM "ImportRateWindow" WHERE "subjectHash"=$1`, [input.subjectHash],
  );
  throw new RepoReplayError("IMPORT_RATE_LIMITED", "Too many repository checks or imports. Wait before trying again.", {
    retryAfterSeconds: window.rows[0]?.retryAfterSeconds ?? input.windowSeconds,
  });
}

export async function admitProcessingRun(client: PoolClient, maximum = DEFAULT_GLOBAL_PENDING_RUNS): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(726321, 1)");
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS "count" FROM "ProcessingRun"
     WHERE "status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE')`,
  );
  if (result.rows[0].count >= maximum) {
    throw new RepoReplayError("GLOBAL_RUN_LIMITED", "Processing capacity is currently full. Try again after an existing run finishes.", { retryAfterSeconds: 30 });
  }
}

export async function cleanupRequestRecords(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM "IdempotencyRecord" WHERE "expiresAt"<=CURRENT_TIMESTAMP`);
  await client.query(`DELETE FROM "ImportRateWindow" WHERE "resetsAt"<=CURRENT_TIMESTAMP`);
}
