import { Pool } from "pg";

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}
