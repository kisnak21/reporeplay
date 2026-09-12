import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/repositories/[repositoryId]/commits/route";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
vi.mock("../../src/server/db/client-pool", () => ({ getPool: () => pool }));
const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeDatabase("timeline filters against persisted evidence", () => {
  let repositoryId: string;
  let runId: string;
  const fixtureName = `filter-${randomUUID()}`;
  beforeAll(async () => {
    const repository = await pool.query<{ id: string }>(
      `INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","updatedAt")
       VALUES(gen_random_uuid(),'GITHUB',$1,'filter',$1,'filter/'||$1,'https://github.com/filter/'||$1,'main',CURRENT_TIMESTAMP) RETURNING "id"`, [fixtureName],
    );
    repositoryId = repository.rows[0].id;
    const run = await pool.query<{ id: string }>(
      `INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit",
        "schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep")
       VALUES(gen_random_uuid(),$1,'IMPORT','SUCCEEDED','main','head',2,500,25000,'1','1','1','1','COMPLETE') RETURNING "id"`, [repositoryId],
    );
    runId = run.rows[0].id;
    await pool.query(`UPDATE "Repository" SET "activeRunId"=$1,"availability"='READY' WHERE "id"=$2`, [runId, repositoryId]);
    for (const [sequence, committedAt] of ["2026-09-01T00:00:00Z", "2026-09-02T23:59:59.999Z", "2026-09-03T00:00:00Z"].entries()) {
      const commitId = randomUUID();
      await pool.query(
        `INSERT INTO "RunCommit"("id","runId","sha","shortSha","treeSha","sequence","message","committedAt","additions","deletions","changedFileCount","externalUrl")
         VALUES($1,$2,$3,$3,'tree',$4,'fix: repair account',$5,1,0,1,'https://github.com/filter/commit/'||$3)`,
        [commitId, runId, `sha-${sequence}`, sequence, committedAt],
      );
      await pool.query(`INSERT INTO "CommitCategory"("id","runId","runCommitId","category","source") VALUES(gen_random_uuid(),$1,$2,'FIX','CONVENTIONAL_COMMIT')`, [runId, commitId]);
      await pool.query(`INSERT INTO "CommitFile"("id","runId","runCommitId","path","previousPath","status","additions","deletions","changes") VALUES(gen_random_uuid(),$1,$2,'src/new.ts','src/old.ts','RENAMED',1,0,1)`, [runId, commitId]);
      await pool.query(`INSERT INTO "RouteChange"("id","runId","runCommitId","router","route","sourcePath","routeType","changeType") VALUES(gen_random_uuid(),$1,$2,'APP','/account','app/account/page.tsx','PAGE','ADDED')`, [runId, commitId]);
    }
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM "Repository" WHERE "externalId"=$1`, [fixtureName]);
    await pool.end();
  });

  it("combines category, keyword, renamed path, event, and an inclusive final day", async () => {
    const response = await GET(new Request(`http://localhost/api/repositories/${repositoryId}/commits?query=account&category=FIX&path=src/old.ts&event=ROUTE&from=2026-09-02&to=2026-09-02`), { params: Promise.resolve({ repositoryId }) });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.items.map((item: { sha: string }) => item.sha)).toEqual(["sha-1"]);
    expect(data.snapshot.runId).toBe(runId);
  });

  it("keeps filters when loading the next cursor page", async () => {
    const context = { params: Promise.resolve({ repositoryId }) };
    const first = await GET(new Request(`http://localhost/api/repositories/${repositoryId}/commits?limit=1&category=FIX`), context);
    const firstPage = (await first.json()).data;
    expect(firstPage.items[0].sha).toBe("sha-2");
    const second = await GET(new Request(`http://localhost/api/repositories/${repositoryId}/commits?limit=1&category=FIX&cursor=${firstPage.pageInfo.nextCursor}`), context);
    expect((await second.json()).data.items[0].sha).toBe("sha-1");
  });

  it("returns a stable validation error for invalid filter values", async () => {
    const response = await GET(new Request(`http://localhost/api/repositories/${repositoryId}/commits?category=UNKNOWN`), { params: Promise.resolve({ repositoryId }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });
});
