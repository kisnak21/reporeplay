import { NextResponse } from "next/server";
import { z } from "zod";
import { parseEnvironment } from "@/lib/environment";
import { parseGitHubRepositoryUrl } from "@/server/github/repository-url";
import { createGitHubSourceFromEnvironment } from "@/server/github/client";
import { runPreflight } from "@/server/github/preflight";
import { RepoReplayError } from "@/server/github/errors";
import { getPool } from "@/server/db/client-pool";

const bodySchema = z.object({ url: z.string().min(1), appRoot: z.string().optional() });

function statusForCode(code: string): number {
  switch (code) {
    case "INVALID_REPOSITORY_URL":
      return 400;
    case "REPOSITORY_NOT_FOUND":
      return 404;
    case "REPOSITORY_NOT_PUBLIC":
      return 403;
    case "EMPTY_REPOSITORY":
      return 409;
    case "UNSUPPORTED_REPOSITORY":
      return 422;
    case "REPOSITORY_LIMIT_EXCEEDED":
      return 422;
    case "GITHUB_RATE_LIMITED":
      return 429;
    default:
      return 500;
  }
}

export async function POST(request: Request) {
  try {
    const env = parseEnvironment(process.env);
    const pool = getPool(env.DATABASE_URL);
    const json = await request.json();
    const { url, appRoot } = bodySchema.parse(json);
    const ref = parseGitHubRepositoryUrl(url);
    const source = createGitHubSourceFromEnvironment(env);
    const preflight = await runPreflight({ source, owner: ref.owner, name: ref.name, maxCommits: env.MAX_FIRST_PARENT_COMMITS, maxFiles: env.MAX_HEAD_FILES });

    let selectedAppRoot: string | null = null;
    if (preflight.candidates.length === 1) selectedAppRoot = preflight.candidates[0].path;
    else if (appRoot) {
      const match = preflight.candidates.find((c) => c.path === appRoot);
      if (!match) throw new RepoReplayError("INVALID_APP_ROOT_SELECTION", "Selected app root does not match discovered candidates.");
      selectedAppRoot = match.path;
    } else {
      return NextResponse.json({ error: { code: "CONFIGURATION_REQUIRED", message: "Multiple Next.js applications found. Select one.", details: { candidates: preflight.candidates } } }, { status: 409 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const repoResult = await client.query<{ id: string }>(
        `INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","selectedAppRoot","availability","updatedAt")
         VALUES(gen_random_uuid(),'GITHUB',$1,$2,$3,$4,$5,$6,$7,'PROCESSING',CURRENT_TIMESTAMP)
         ON CONFLICT("provider","externalId") DO UPDATE SET "owner"=EXCLUDED."owner","name"=EXCLUDED."name","fullName"=EXCLUDED."fullName","canonicalUrl"=EXCLUDED."canonicalUrl","defaultBranch"=EXCLUDED."defaultBranch","selectedAppRoot"=EXCLUDED."selectedAppRoot","updatedAt"=CURRENT_TIMESTAMP
         RETURNING "id"`,
        [preflight.repository.externalId, preflight.repository.owner, preflight.repository.name, preflight.repository.fullName, preflight.repository.canonicalUrl, preflight.repository.defaultBranch, selectedAppRoot],
      );
      const repositoryId = repoResult.rows[0].id;
      const existing = await client.query<{ id: string }>(`SELECT "id" FROM "ProcessingRun" WHERE "repositoryId"=$1 AND "status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE') LIMIT 1`, [repositoryId]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return NextResponse.json({ data: { repositoryId, runId: existing.rows[0].id, status: "QUEUED" } }, { status: 200 });
      }
      const runResult = await client.query<{ id: string }>(
        `INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","selectedAppRoot","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep")
         VALUES(gen_random_uuid(),$1,'IMPORT','QUEUED',$2,$3,$4,$5,$6,$7,'1','1','1','1','DISCOVER_HISTORY') RETURNING "id"`,
        [repositoryId, selectedAppRoot, preflight.repository.defaultBranch, preflight.headSha, preflight.headFileCount, env.MAX_FIRST_PARENT_COMMITS, env.MAX_HEAD_FILES],
      );
      const runId = runResult.rows[0].id;
      await client.query(`INSERT INTO "ProcessingJob"("id","runId","status","updatedAt") VALUES(gen_random_uuid(),$1,'QUEUED',CURRENT_TIMESTAMP)`, [runId]);
      await client.query("COMMIT");
      return NextResponse.json({ data: { repositoryId, runId, status: "QUEUED" } }, { status: 201 });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  } catch (error) {
    if (error instanceof RepoReplayError) return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: statusForCode(error.code) });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "INVALID_REPOSITORY_URL", message: "Invalid request." } }, { status: 400 });
    return NextResponse.json({ error: { code: "GITHUB_UNAVAILABLE", message: "Unexpected error." } }, { status: 500 });
  }
}
