import type { Pool, PoolClient } from "pg";

export type Database = Pool | PoolClient;

export async function inTransaction<T>(database: Database, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  if ("release" in database) return operation(database);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
