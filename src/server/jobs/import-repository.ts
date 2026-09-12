import type { PoolClient } from "pg";
import type { PreflightEvidence } from "@/server/security/preflight-token";
import type { MutationResult } from "@/server/api/idempotency";
import { admitProcessingRun } from "@/server/security/import-controls";
import { RepoReplayError } from "@/server/github/errors";
import type { RunStatus } from "@/server/contracts/processing";

interface ImportInput {
  evidence: PreflightEvidence;
  appRoot?: string;
  maxPendingRuns: number;
}

interface ExistingRepository {
  id: string;
  activeRunId: string | null;
  availability: string;
}

export async function createOrReuseImport(client: PoolClient, input: ImportInput): Promise<MutationResult> {
  const { evidence, appRoot } = input;
  const repository = evidence.repository;
  if (appRoot !== undefined && !evidence.candidates.some((candidate) => candidate.path === appRoot)) {
    throw new RepoReplayError("INVALID_APP_ROOT_SELECTION", "Select an application root discovered by preflight.");
  }
  const selectedAppRoot = appRoot ?? (evidence.candidates.length === 1 ? evidence.candidates[0].path : null);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`github-repository:${repository.externalId}`]);
  const existing = await client.query<ExistingRepository>(
    `SELECT "id","activeRunId","availability" FROM "Repository"
     WHERE "provider"='GITHUB' AND "externalId"=$1 AND "deletedAt" IS NULL FOR UPDATE`, [repository.externalId],
  );
  const current = existing.rows[0];
  if (current?.activeRunId) {
    const snapshot = await client.query<{ headSha: string; processedAt: Date }>(
      `SELECT "headSha",COALESCE("activatedAt","completedAt") AS "processedAt" FROM "ProcessingRun" WHERE "id"=$1`, [current.activeRunId],
    );
    return { status: 200, body: { data: { repositoryId: current.id, availability: "READY", activeSnapshot: { runId: current.activeRunId, ...snapshot.rows[0] } } } };
  }
  if (current) {
    const active = await client.query<{ id: string; status: RunStatus }>(
      `SELECT "id","status" FROM "ProcessingRun" WHERE "repositoryId"=$1
       AND "status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE') LIMIT 1`, [current.id],
    );
    if (active.rows[0]) {
      const run = active.rows[0];
      const candidates = await client.query(
        `SELECT "path","evidenceManifestPath" AS "manifestPath","routeRoots" FROM "RunAppRootCandidate" WHERE "runId"=$1 ORDER BY "path"`, [run.id],
      );
      return { status: 200, body: { data: { repositoryId: current.id, availability: current.availability, run: { ...run, ...(run.status === "NEEDS_CONFIGURATION" ? { appRootCandidates: candidates.rows } : {}) } } } };
    }
  }
  await admitProcessingRun(client, input.maxPendingRuns);
  const availability = selectedAppRoot === null ? "CONFIGURATION_REQUIRED" : "PROCESSING";
  const saved = await client.query<{ id: string }>(
    `INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","selectedAppRoot","availability","updatedAt")
     VALUES(gen_random_uuid(),'GITHUB',$1,$2,$3,$4,$5,$6,$7,$8::"RepositoryAvailability",CURRENT_TIMESTAMP)
     ON CONFLICT("provider","externalId") DO UPDATE SET "availability"=EXCLUDED."availability","updatedAt"=CURRENT_TIMESTAMP
     RETURNING "id"`,
    [repository.externalId, repository.owner, repository.name, repository.fullName, repository.canonicalUrl, repository.defaultBranch, selectedAppRoot, availability],
  );
  const repositoryId = saved.rows[0].id;
  const status = selectedAppRoot === null ? "NEEDS_CONFIGURATION" : "QUEUED";
  const run = await client.query<{ id: string }>(
    `INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","selectedAppRoot","defaultBranch","headSha",
       "expectedCommitCount","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion",
       "dependencyDetectorVersion","routeDetectorVersion","currentStep")
     VALUES(gen_random_uuid(),$1,'IMPORT',$2::"ProcessingRunStatus",$3,$4,$5,$6,$7,$8,$9,'1','1','1','1','DISCOVER_HISTORY') RETURNING "id"`,
    [repositoryId, status, selectedAppRoot, repository.defaultBranch, evidence.headSha, evidence.firstParentCommitCount,
      evidence.headFileCount, evidence.limits.maxFirstParentCommits, evidence.limits.maxHeadFiles],
  );
  const runId = run.rows[0].id;
  for (const candidate of evidence.candidates) {
    await client.query(
      `INSERT INTO "RunAppRootCandidate"("id","runId","path","evidenceManifestPath","routeRoots") VALUES(gen_random_uuid(),$1,$2,$3,$4)`,
      [runId, candidate.path, candidate.manifestPath, candidate.routeRoots],
    );
  }
  if (selectedAppRoot !== null) {
    await client.query(`INSERT INTO "ProcessingJob"("id","runId","status","updatedAt") VALUES(gen_random_uuid(),$1,'QUEUED',CURRENT_TIMESTAMP)`, [runId]);
  }
  return { status: 202, body: { data: { repositoryId, availability, run: { id: runId, status,
    ...(selectedAppRoot === null ? { appRootCandidates: evidence.candidates } : {}),
  } } } };
}
