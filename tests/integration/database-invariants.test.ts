import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Phase 0 database invariants", () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => client.connect());
  afterAll(async () => client.end());

  it("enforces one nonterminal run per repository", async () => {
    await client.query("BEGIN");
    try {
      const repository = await createRepository(client, "invariant-one");
      await createRun(client, repository, "QUEUED", "head-one");
      await expect(createRun(client, repository, "RETRYABLE", "head-two")).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("allows terminal history beside a new active run", async () => {
    await client.query("BEGIN");
    try {
      const repository = await createRepository(client, "invariant-two");
      await createRun(client, repository, "FAILED", "head-one");
      await expect(createRun(client, repository, "QUEUED", "head-two")).resolves.toBeDefined();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("cascades jobs when a repository is deleted", async () => {
    await client.query("BEGIN");
    try {
      const repository = await createRepository(client, "invariant-three");
      const run = await createRun(client, repository, "QUEUED", "head-one");
      await client.query(`INSERT INTO "ProcessingJob" ("id", "runId", "status", "updatedAt") VALUES (gen_random_uuid(), $1, 'QUEUED', CURRENT_TIMESTAMP)`, [run]);
      await client.query(`DELETE FROM "Repository" WHERE "id" = $1`, [repository]);
      const jobs = await client.query(`SELECT COUNT(*)::int AS count FROM "ProcessingJob" WHERE "runId" = $1`, [run]);
      expect(jobs.rows[0].count).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

async function createRepository(client: Client, externalId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO "Repository" ("id", "provider", "externalId", "owner", "name", "fullName", "canonicalUrl", "defaultBranch", "updatedAt")
     VALUES (gen_random_uuid(), 'GITHUB', $1, 'test', $1, 'test/' || $1, 'https://github.com/test/' || $1, 'main', CURRENT_TIMESTAMP)
     RETURNING "id"`,
    [externalId],
  );
  return result.rows[0].id;
}

async function createRun(client: Client, repositoryId: string, status: string, headSha: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO "ProcessingRun" ("id", "repositoryId", "kind", "status", "defaultBranch", "headSha", "headFileCount", "maxCommitLimit", "maxHeadFileLimit", "schemaVersion", "classifierVersion", "dependencyDetectorVersion", "routeDetectorVersion", "currentStep")
     VALUES (gen_random_uuid(), $1, 'IMPORT', $2::"ProcessingRunStatus", 'main', $3, 1, 500, 25000, '1', '1', '1', '1', 'DISCOVER_HISTORY')
     RETURNING "id"`,
    [repositoryId, status, headSha],
  );
  return result.rows[0].id;
}
