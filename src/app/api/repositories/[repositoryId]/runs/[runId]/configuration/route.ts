import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/server/db/client-pool";
import { configureRunAppRoot } from "@/server/jobs/manual-refresh";

const bodySchema = z.object({ appRoot: z.string().min(1) });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string; runId: string }> },
) {
  try {
    const { repositoryId, runId } = await params;
    const body = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: { code: "INVALID_APP_ROOT_SELECTION", message: "Select an application root before continuing." } },
        { status: 422 },
      );
    }
    const { appRoot } = parsedBody.data;
    const result = await configureRunAppRoot(
      getPool(process.env.DATABASE_URL!),
      repositoryId,
      runId,
      appRoot,
    );

    switch (result.outcome) {
      case "QUEUED":
        return NextResponse.json(
          { data: { repositoryId, runId, status: result.outcome, selectedAppRoot: appRoot } },
          { status: 202 },
        );
      case "NOT_FOUND":
        return NextResponse.json(
          { error: { code: "REPOSITORY_NOT_FOUND", message: "Repository not found." } },
          { status: 404 },
        );
      case "RUN_NOT_FOUND":
        return NextResponse.json(
          { error: { code: "RUN_NOT_FOUND", message: "Run not found." } },
          { status: 404 },
        );
      case "RUN_NOT_CONFIGURABLE":
        return NextResponse.json(
          { error: { code: "RUN_NOT_CONFIGURABLE", message: "This run no longer accepts application-root configuration." } },
          { status: 409 },
        );
      case "INVALID_APP_ROOT_SELECTION":
        return NextResponse.json(
          { error: { code: "INVALID_APP_ROOT_SELECTION", message: "Select an application root discovered by this run's preflight." } },
          { status: 422 },
        );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "The application root could not be saved." } },
      { status: 503 },
    );
  }
}
