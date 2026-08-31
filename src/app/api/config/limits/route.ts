import { NextResponse } from "next/server";
import { parseEnvironment } from "@/lib/environment";

export async function GET() {
  const env = parseEnvironment(process.env);
  return NextResponse.json({
    data: {
      maxFirstParentCommits: env.MAX_FIRST_PARENT_COMMITS,
      maxHeadFiles: env.MAX_HEAD_FILES,
      timelineDefaultLimit: 30,
      timelineMaxLimit: 100,
    },
  });
}
