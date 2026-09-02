import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";

export async function GET() {
  try {
    const pool = getPool(process.env.DATABASE_URL!);
    await pool.query("SELECT 1");
    return NextResponse.json({ data: { status: "ok", checks: { database: "ok" } } });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "The service is temporarily unavailable." } }, { status: 503 });
  }
}
