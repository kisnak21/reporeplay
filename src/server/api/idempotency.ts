import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "@/server/db/transaction";
import { RepoReplayError } from "@/server/github/errors";

export interface MutationResult {
  status: number;
  body: unknown;
}

interface MutationInput {
  pool: Pool;
  request: Request;
  normalizedBody: unknown;
  retentionSeconds: number;
}

export async function idempotentMutation(input: MutationInput, operation: (client: PoolClient) => Promise<MutationResult>): Promise<NextResponse> {
  const key = input.request.headers.get("Idempotency-Key");
  if (key !== null && !/^[\x21-\x7e]{1,128}$/.test(key)) {
    throw new RepoReplayError("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must contain 1 to 128 printable characters without spaces.");
  }
  const result = await inTransaction(input.pool, async (client) => {
    if (!key) return operation(client);
    const scope = `${input.request.method}:${new URL(input.request.url).pathname}`;
    const keyHash = createHash("sha256").update(key).digest("hex");
    const requestHash = createHash("sha256").update(JSON.stringify(input.normalizedBody)).digest("hex");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${scope}:${keyHash}`]);
    const stored = await client.query<{ requestHash: string; status: number; response: unknown }>(
      `SELECT "requestHash","status","response" FROM "IdempotencyRecord"
       WHERE "scope"=$1 AND "keyHash"=$2 AND "expiresAt">CURRENT_TIMESTAMP`, [scope, keyHash],
    );
    if (stored.rows[0]) {
      if (stored.rows[0].requestHash !== requestHash) {
        throw new RepoReplayError("IDEMPOTENCY_KEY_CONFLICT", "This idempotency key was already used for a different request.");
      }
      return { status: stored.rows[0].status, body: stored.rows[0].response };
    }
    const response = await operation(client);
    await client.query(
      `INSERT INTO "IdempotencyRecord"("scope","keyHash","requestHash","status","response","expiresAt")
       VALUES($1,$2,$3,$4,$5::jsonb,CURRENT_TIMESTAMP + ($6 * INTERVAL '1 second'))
       ON CONFLICT("scope","keyHash") DO UPDATE SET "requestHash"=EXCLUDED."requestHash",
         "status"=EXCLUDED."status","response"=EXCLUDED."response","expiresAt"=EXCLUDED."expiresAt"`,
      [scope, keyHash, requestHash, response.status, JSON.stringify(response.body), input.retentionSeconds],
    );
    return response;
  });
  return NextResponse.json(result.body, { status: result.status });
}
