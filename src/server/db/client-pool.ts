import { Pool } from "pg";

const globalForPool = globalThis as unknown as { __reporeplayPool?: Pool };

export function getPool(connectionString: string): Pool {
  if (globalForPool.__reporeplayPool) return globalForPool.__reporeplayPool;
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  if (process.env.NODE_ENV !== "production") globalForPool.__reporeplayPool = pool;
  return pool;
}
