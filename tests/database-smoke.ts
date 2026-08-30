import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the database smoke test");
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const result = await client.query<{ name: string }>(
    "SELECT \"table_name\" AS name FROM information_schema.tables WHERE table_schema = 'public' AND \"table_name\" IN ('Repository', 'ProcessingRun', 'ProcessingJob') ORDER BY \"table_name\"",
  );

  const tableNames = result.rows.map((row) => row.name);
  if (tableNames.length !== 3) {
    throw new Error(`Expected Phase 0 tables, found: ${tableNames.join(", ")}`);
  }

  await client.query("BEGIN");
  const repository = await client.query<{ id: string }>(
    `INSERT INTO "Repository" ("id", "provider", "externalId", "owner", "name", "fullName", "canonicalUrl", "defaultBranch", "updatedAt")
     VALUES (gen_random_uuid(), 'GITHUB', 'smoke-test', 'smoke', 'test', 'smoke/test', 'https://github.com/smoke/test', 'main', CURRENT_TIMESTAMP)
     RETURNING "id"`,
  );
  await client.query(
    `INSERT INTO "ProcessingRun" ("id", "repositoryId", "kind", "status", "defaultBranch", "headSha", "headFileCount", "maxCommitLimit", "maxHeadFileLimit", "schemaVersion", "classifierVersion", "dependencyDetectorVersion", "routeDetectorVersion", "currentStep")
     VALUES (gen_random_uuid(), $1, 'IMPORT', 'QUEUED', 'main', 'smoke-head', 1, 500, 25000, '1', '1', '1', '1', 'DISCOVER_HISTORY')`,
    [repository.rows[0].id],
  );
  await client.query("ROLLBACK");
  process.stdout.write("Database smoke test: PASS\n");
} finally {
  await client.end();
}
