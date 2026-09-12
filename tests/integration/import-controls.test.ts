import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inTransaction } from "../../src/server/db/transaction";
import { createOrReuseImport } from "../../src/server/jobs/import-repository";
import { idempotentMutation } from "../../src/server/api/idempotency";
import { consumeImportQuota, requestSubject } from "../../src/server/security/import-controls";
import { parseEnvironment } from "../../src/lib/environment";
import { claimNextDueJob, failJob } from "../../src/server/jobs/repository";
import { signPreflightToken, type PreflightEvidence } from "../../src/server/security/preflight-token";
import { POST as importRepository } from "../../src/app/api/repositories/route";
import { POST as preflightRepository } from "../../src/app/api/repositories/preflight/route";
import { PUT as configureRoot } from "../../src/app/api/repositories/[repositoryId]/runs/[runId]/configuration/route";
import { POST as retryRun } from "../../src/app/api/repositories/[repositoryId]/runs/[runId]/retry/route";
import { POST as cancelRun } from "../../src/app/api/repositories/[repositoryId]/runs/[runId]/cancel/route";
import { POST as refreshRepository } from "../../src/app/api/repositories/[repositoryId]/refresh/route";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
vi.mock("../../src/server/db/client-pool", () => ({ getPool: () => pool }));
vi.mock("../../src/server/github/client", () => ({ createGitHubSourceFromEnvironment: () => source }));

const secret = "integration-test-signing-secret-with-32-characters";
const keyPrefix = randomUUID();
const keyHashes = new Set<string>();
const quotaSubject = `controls-${keyPrefix}`;
let requestSubjectHash: string;
let evidence: PreflightEvidence;
const source = {
  getRepository: vi.fn(async () => ({ ...evidence.repository, isPrivate: false, isEmpty: false })),
  getBranchHead: vi.fn(async () => evidence.headSha),
  getCommit: vi.fn(async () => ({ sha: evidence.headSha, parentShas: [], treeSha: "tree", message: "initial", files: [], additions: 0, deletions: 0, changedFileCount: 0 })),
  getTree: vi.fn(async () => ({ treeSha: "tree", complete: true, paths: ["package.json", "app/page.tsx"] })),
  getFile: vi.fn(async () => JSON.stringify({ dependencies: { next: "16.2.9" } })),
};

interface ImportResponse {
  repositoryId: string;
  availability: string;
  run: { id: string; status: string; appRootCandidates?: unknown[] };
  activeSnapshot?: { runId: string };
}

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;
describeDatabase("import contracts and shared request controls", () => {
  beforeAll(() => {
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "test-private-key");
    vi.stubEnv("PREFLIGHT_SIGNING_SECRET", secret);
    vi.stubEnv("MAX_IMPORTS_PER_IP_WINDOW", "100");
    requestSubjectHash = requestSubject(new Request("http://localhost"), parseEnvironment(process.env));
  });
  beforeEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    evidence = createEvidence();
  });
  afterAll(async () => {
    await cleanup();
    await pool.end();
    vi.unstubAllEnvs();
  });

  it("issues a signed preflight and imports its frozen head without another GitHub traversal", async () => {
    const checked = await preflightRepository(new Request("http://localhost/api/repositories/preflight", {
      method: "POST", body: JSON.stringify({ url: evidence.repository.canonicalUrl }),
    }));
    expect(checked.status).toBe(200);
    const { data } = await checked.json();
    const calls = source.getCommit.mock.calls.length;
    const response = await importRepository(importRequest({ preflightToken: data.preflightToken }));
    expect(response.status).toBe(202);
    expect(source.getCommit).toHaveBeenCalledTimes(calls);
    const imported = (await response.json()).data as ImportResponse;
    expect(imported.availability).toBe("PROCESSING");
    expect(imported.run.status).toBe("QUEUED");
    const run = await pool.query(`SELECT "headSha","expectedCommitCount" FROM "ProcessingRun" WHERE "id"=$1`, [imported.run.id]);
    expect(run.rows[0]).toEqual({ headSha: evidence.headSha, expectedCommitCount: 1 });
  });

  it("rejects expired and tampered tokens without creating a repository", async () => {
    const expired = signPreflightToken(evidence, { secret, lifetimeSeconds: 1, now: 0 });
    const response = await importRepository(importRequest({ preflightToken: expired }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("PREFLIGHT_TOKEN_EXPIRED");
    const tampered = await importRepository(importRequest({ preflightToken: `${token()}x` }));
    expect(tampered.status).toBe(400);
    expect((await pool.query(`SELECT COUNT(*)::int AS count FROM "Repository" WHERE "externalId"=$1`, [evidence.repository.externalId])).rows[0].count).toBe(0);
  });

  it("coalesces simultaneous imports with different keys", async () => {
    const preflightToken = token();
    const responses = await Promise.all([importRepository(importRequest({ preflightToken })), importRepository(importRequest({ preflightToken }))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 202]);
    const results = await Promise.all(responses.map(async (response) => (await response.json()).data as ImportResponse));
    expect(results[0].run.id).toBe(results[1].run.id);
    expect((await pool.query(`SELECT COUNT(*)::int AS count FROM "ProcessingJob" WHERE "runId"=$1`, [results[0].run.id])).rows[0].count).toBe(1);
  });

  it("replays the exact response for one key and rejects key reuse with a different body", async () => {
    const body = { preflightToken: token() };
    const responses = await Promise.all([importRepository(importRequest(body, "same-key")), importRepository(importRequest(body, "same-key"))]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    const conflict = await importRepository(importRequest({ ...body, appRoot: "." }, "same-key"));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect((await pool.query(`SELECT "count" FROM "ImportRateWindow" WHERE "subjectHash"=$1`, [requestSubjectHash])).rows[0].count).toBe(1);
  });

  it("returns the ready repository without creating a new import or changing its metadata", async () => {
    const imported = await queue();
    await activateFixture(imported);
    evidence.repository.defaultBranch = "new-default";
    const response = await importRepository(importRequest({ preflightToken: token() }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.activeSnapshot.runId).toBe(imported.run.id);
    const repository = await pool.query(`SELECT "defaultBranch",(SELECT COUNT(*)::int FROM "ProcessingRun" WHERE "repositoryId"=$1) AS runs FROM "Repository" WHERE "id"=$1`, [imported.repositoryId]);
    expect(repository.rows[0]).toEqual({ defaultBranch: "main", runs: 1 });
  });

  it("reuses the actual status of a running import", async () => {
    const imported = await queue();
    await claimNextDueJob(pool, "controls-existing-worker", 60);
    const response = await importRepository(importRequest({ preflightToken: token() }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.run).toEqual({ id: imported.run.id, status: "RUNNING" });
  });

  it("replays a completed request even after its preflight token expires", async () => {
    const body = { preflightToken: token() };
    const first = await importRepository(importRequest(body, "expired-token-replay"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      const replay = await importRepository(importRequest(body, "expired-token-replay"));
      expect(replay.status).toBe(202);
      expect(await replay.json()).toEqual(await first.json());
    } finally {
      clock.mockRestore();
    }
  });

  it("returns quota errors with Retry-After before contacting GitHub", async () => {
    const previousLimit = process.env.MAX_IMPORTS_PER_IP_WINDOW;
    vi.stubEnv("MAX_IMPORTS_PER_IP_WINDOW", "1");
    try {
      await queue();
      const response = await preflightRepository(new Request("http://localhost/api/repositories/preflight", {
        method: "POST", body: JSON.stringify({ url: evidence.repository.canonicalUrl }),
      }));
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(source.getRepository).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("MAX_IMPORTS_PER_IP_WINDOW", previousLimit);
    }
  });

  it("persists an ambiguous import and configures its original run with replay protection", async () => {
    evidence.candidates.push({ path: "apps/admin", manifestPath: "apps/admin/package.json", routeRoots: ["pages"], routeFileCount: 1 });
    const imported = await queue();
    expect(imported.availability).toBe("CONFIGURATION_REQUIRED");
    expect(imported.run.status).toBe("NEEDS_CONFIGURATION");
    expect((await pool.query(`SELECT COUNT(*)::int AS count FROM "ProcessingJob" WHERE "runId"=$1`, [imported.run.id])).rows[0].count).toBe(0);
    const context = runContext(imported);
    const request = () => new Request(`http://localhost/api/repositories/${imported.repositoryId}/runs/${imported.run.id}/configuration`, {
      method: "PUT", headers: { "Idempotency-Key": trackedKey("root-key") }, body: JSON.stringify({ appRoot: "apps/admin" }),
    });
    const configured = await configureRoot(request(), context);
    const replayed = await configureRoot(request(), context);
    expect(configured.status).toBe(202);
    expect(await replayed.json()).toEqual(await configured.json());
    expect((await pool.query(`SELECT "selectedAppRoot" FROM "ProcessingRun" WHERE "id"=$1`, [imported.run.id])).rows[0].selectedAppRoot).toBe("apps/admin");
  });

  it("replays refresh without another preflight or another run", async () => {
    const imported = await queue();
    await activateFixture(imported);
    const request = () => new Request(`http://localhost/api/repositories/${imported.repositoryId}/refresh`, { method: "POST", headers: { "Idempotency-Key": trackedKey("refresh-key") } });
    const context = { params: Promise.resolve({ repositoryId: imported.repositoryId }) };
    const first = await refreshRepository(request(), context);
    const second = await refreshRepository(request(), context);
    expect(first.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    expect(source.getRepository).toHaveBeenCalledTimes(1);
  });

  it("replays retry and cancellation even after each operation changes the run state", async () => {
    const imported = await queue();
    const job = await claimNextDueJob(pool, "controls-worker", 60);
    expect(job).not.toBeNull();
    await failJob(pool, job!, "PROCESSING_FAILED", "Fixture failure");
    const request = (action: string) => new Request(`http://localhost/api/repositories/${imported.repositoryId}/runs/${imported.run.id}/${action}`, { method: "POST", headers: { "Idempotency-Key": trackedKey(`${action}-key`) } });
    const context = runContext(imported);
    const retry = await retryRun(request("retry"), context);
    expect(retry.status).toBe(202);
    expect(await (await retryRun(request("retry"), context)).json()).toEqual(await retry.json());
    const cancel = await cancelRun(request("cancel"), context);
    expect(cancel.status).toBe(200);
    expect(await (await cancelRun(request("cancel"), context)).json()).toEqual(await cancel.json());
  });

  it("rolls back the mutation together with its replay record on failure", async () => {
    await expect(idempotentMutation({ pool, request: importRequest({}, "rollback-key"), normalizedBody: {}, retentionSeconds: 60 }, async (client) => {
      await createOrReuseImport(client, { evidence, maxPendingRuns: 20 });
      throw new Error("Failure before response persistence");
    })).rejects.toThrow("Failure before");
    expect((await pool.query(`SELECT COUNT(*)::int AS count FROM "Repository" WHERE "externalId"=$1`, [evidence.repository.externalId])).rows[0].count).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS count FROM "IdempotencyRecord" WHERE "keyHash"=ANY($1::text[])`, [[...keyHashes]])).rows[0].count).toBe(0);
  });

  it("accepts a fresh request after its replay record expires", async () => {
    const operation = vi.fn(async () => ({ status: 202, body: { data: { attempt: randomUUID() } } }));
    const input = { pool, request: importRequest({}, "expiry-key"), normalizedBody: {}, retentionSeconds: 60 };
    const first = await idempotentMutation(input, operation);
    await pool.query(`UPDATE "IdempotencyRecord" SET "expiresAt"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "keyHash"=ANY($1::text[])`, [[...keyHashes]]);
    const second = await idempotentMutation(input, operation);
    expect(await first.json()).not.toEqual(await second.json());
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("enforces the IP window across concurrent requests and resets expired windows", async () => {
    const consume = () => inTransaction(pool, (client) => consumeImportQuota(client, { subjectHash: quotaSubject, maximum: 2, windowSeconds: 60 }));
    const results = await Promise.allSettled(Array.from({ length: 6 }, consume));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
    await pool.query(`UPDATE "ImportRateWindow" SET "resetsAt"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "subjectHash"=$1`, [quotaSubject]);
    await consume();
    expect((await pool.query(`SELECT "count" FROM "ImportRateWindow" WHERE "subjectHash"=$1`, [quotaSubject])).rows[0].count).toBe(1);
  });

  it("admits only the configured number of unfinished runs across different repositories", async () => {
    const results = await Promise.allSettled([evidence, createEvidence()].map((entry) => inTransaction(pool, (client) => createOrReuseImport(client, { evidence: entry, maxPendingRuns: 1 }))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("enforces the global running limit across workers and reuses released capacity", async () => {
    await queue();
    await inTransaction(pool, (client) => createOrReuseImport(client, { evidence: createEvidence(), maxPendingRuns: 20 }));
    const jobs = await Promise.all(["controls-a", "controls-b"].map((workerId) => claimNextDueJob(pool, workerId, { leaseSeconds: 60, maxRunningJobs: 1 })));
    expect(jobs.filter(Boolean)).toHaveLength(1);
    await failJob(pool, jobs.find((job) => job !== null)!, "PROCESSING_FAILED", "Release fixture capacity");
    expect(await claimNextDueJob(pool, "controls-c", { leaseSeconds: 60, maxRunningJobs: 1 })).not.toBeNull();
  });
});

function createEvidence(): PreflightEvidence {
  const id = `controls-${randomUUID()}`;
  return {
    repository: { externalId: id, owner: "controls", name: id, fullName: `controls/${id}`, canonicalUrl: `https://github.com/controls/${id}`, defaultBranch: "main" },
    headSha: "a".repeat(40), firstParentCommitCount: 1, headFileCount: 2,
    candidates: [{ path: ".", manifestPath: "package.json", routeRoots: ["app"], routeFileCount: 1 }],
    limits: { maxFirstParentCommits: 500, maxHeadFiles: 25_000 },
  };
}

function token() { return signPreflightToken(evidence, { secret, lifetimeSeconds: 60 }); }
function importRequest(body: unknown, key: string = randomUUID()) {
  return new Request("http://localhost/api/repositories", { method: "POST", headers: { "Idempotency-Key": trackedKey(key) }, body: JSON.stringify(body) });
}
function trackedKey(key: string) {
  const value = `${keyPrefix}:${key}`;
  keyHashes.add(createHash("sha256").update(value).digest("hex"));
  return value;
}
async function queue(): Promise<ImportResponse> {
  const response = await importRepository(importRequest({ preflightToken: token() }));
  expect(response.status).toBe(202);
  return (await response.json()).data;
}
function runContext(imported: ImportResponse) { return { params: Promise.resolve({ repositoryId: imported.repositoryId, runId: imported.run.id }) }; }
async function activateFixture(imported: ImportResponse) {
  await pool.query(`UPDATE "ProcessingJob" SET "status"='SUCCEEDED' WHERE "runId"=$1`, [imported.run.id]);
  await pool.query(`UPDATE "ProcessingRun" SET "status"='SUCCEEDED',"activatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [imported.run.id]);
  await pool.query(`UPDATE "Repository" SET "activeRunId"=$1,"availability"='READY' WHERE "id"=$2`, [imported.run.id, imported.repositoryId]);
}
async function cleanup() {
  await pool.query(`DELETE FROM "Repository" WHERE "externalId" LIKE 'controls-%'`);
  await pool.query(`DELETE FROM "IdempotencyRecord" WHERE "keyHash"=ANY($1::text[])`, [[...keyHashes]]);
  await pool.query(`DELETE FROM "ImportRateWindow" WHERE "subjectHash"=ANY($1::text[])`, [[quotaSubject, requestSubjectHash]]);
  keyHashes.clear();
}
