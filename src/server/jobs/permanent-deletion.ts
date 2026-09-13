import { inTransaction, type Database } from "@/server/db/transaction";

export async function permanentlyDeleteRepository(database: Database, repositoryId: string): Promise<boolean> {
  return inTransaction(database, async (client) => {
    const repository = await client.query(`SELECT "id" FROM "Repository" WHERE "id"=$1 FOR UPDATE`, [repositoryId]);
    if (repository.rowCount !== 1) return false;

    await client.query(`UPDATE "Repository" SET "deletedAt"=COALESCE("deletedAt",CURRENT_TIMESTAMP) WHERE "id"=$1`, [repositoryId]);
    await client.query(
      `UPDATE "ProcessingJob" SET "status"='CANCELLED',"leaseGeneration"="leaseGeneration"+1,
         "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"cancelRequestedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
       WHERE "runId" IN (SELECT "id" FROM "ProcessingRun" WHERE "repositoryId"=$1)
         AND "status" IN ('QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE')`,
      [repositoryId],
    );
    await client.query(
      `UPDATE "ProcessingRun" SET "status"='CANCELLED',"completedAt"=COALESCE("completedAt",CURRENT_TIMESTAMP),"errorCode"=NULL,"errorMessage"=NULL
       WHERE "repositoryId"=$1 AND "status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE')`,
      [repositoryId],
    );

    const deleted = await client.query(`DELETE FROM "Repository" WHERE "id"=$1 RETURNING "id"`, [repositoryId]);
    return deleted.rowCount === 1;
  });
}
