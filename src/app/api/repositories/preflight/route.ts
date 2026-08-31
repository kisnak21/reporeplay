import { NextResponse } from "next/server";
import { z } from "zod";
import { parseEnvironment } from "@/lib/environment";
import { parseGitHubRepositoryUrl } from "@/server/github/repository-url";
import { createGitHubSourceFromEnvironment } from "@/server/github/client";
import { runPreflight } from "@/server/github/preflight";
import { RepoReplayError } from "@/server/github/errors";

const bodySchema = z.object({ url: z.string().min(1) });

function statusForCode(code: string): number {
  switch (code) {
    case "INVALID_REPOSITORY_URL":
      return 400;
    case "REPOSITORY_NOT_FOUND":
      return 404;
    case "REPOSITORY_NOT_PUBLIC":
      return 403;
    case "EMPTY_REPOSITORY":
      return 409;
    case "UNSUPPORTED_REPOSITORY":
      return 422;
    case "REPOSITORY_LIMIT_EXCEEDED":
      return 422;
    case "GITHUB_RATE_LIMITED":
      return 429;
    case "GITHUB_DATA_TRUNCATED":
      return 502;
    default:
      return 500;
  }
}

export async function POST(request: Request) {
  try {
    const env = parseEnvironment(process.env);
    const json = await request.json();
    const { url } = bodySchema.parse(json);
    const ref = parseGitHubRepositoryUrl(url);
    const source = createGitHubSourceFromEnvironment(env);
    const result = await runPreflight({ source, owner: ref.owner, name: ref.name, maxCommits: env.MAX_FIRST_PARENT_COMMITS, maxFiles: env.MAX_HEAD_FILES });
    return NextResponse.json({
      data: {
        repository: { externalId: result.repository.externalId, fullName: result.repository.fullName, defaultBranch: result.repository.defaultBranch, headSha: result.headSha },
        firstParentCommitCount: result.firstParentCommitCount,
        headFileCount: result.headFileCount,
        appRootCandidates: result.candidates,
        limits: { maxFirstParentCommits: env.MAX_FIRST_PARENT_COMMITS, maxHeadFiles: env.MAX_HEAD_FILES },
      },
    });
  } catch (error) {
    if (error instanceof RepoReplayError) return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: statusForCode(error.code) });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "INVALID_REPOSITORY_URL", message: "Invalid request body." } }, { status: 400 });
    return NextResponse.json({ error: { code: "GITHUB_UNAVAILABLE", message: "Unexpected error." } }, { status: 500 });
  }
}
