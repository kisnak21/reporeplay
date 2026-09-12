import { NextResponse } from "next/server";
import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { parseGitHubRepositoryUrl } from "@/server/github/repository-url";
import { createGitHubSourceFromEnvironment } from "@/server/github/client";
import { runPreflight } from "@/server/github/preflight";
import { getPool } from "@/server/db/client-pool";
import { inTransaction } from "@/server/db/transaction";
import { consumeImportQuota, requestSubject } from "@/server/security/import-controls";
import { signPreflightToken, signingSecret } from "@/server/security/preflight-token";
import { apiErrorResponse } from "@/server/api/responses";
import { RepoReplayError } from "@/server/github/errors";

const bodySchema = z.object({ url: z.string().trim().min(1).max(2_048) }).strict();

export async function POST(request: Request) {
  try {
    const environment = apiEnvironment();
    const body = bodySchema.safeParse(await request.json());
    if (!body.success) throw new RepoReplayError("INVALID_REPOSITORY_URL", "Enter a public GitHub repository URL.");
    const ref = parseGitHubRepositoryUrl(body.data.url);
    await inTransaction(getPool(environment.DATABASE_URL), (client) => consumeImportQuota(client, {
      subjectHash: requestSubject(request, environment), maximum: environment.MAX_IMPORTS_PER_IP_WINDOW,
      windowSeconds: environment.IMPORT_IP_WINDOW_SECONDS,
    }));
    const source = createGitHubSourceFromEnvironment(environment);
    const result = await runPreflight({ source, owner: ref.owner, name: ref.name, maxCommits: environment.MAX_FIRST_PARENT_COMMITS, maxFiles: environment.MAX_HEAD_FILES });
    const limits = { maxFirstParentCommits: environment.MAX_FIRST_PARENT_COMMITS, maxHeadFiles: environment.MAX_HEAD_FILES };
    const preflightToken = signPreflightToken({ ...result, limits }, {
      secret: signingSecret(environment), lifetimeSeconds: environment.PREFLIGHT_TOKEN_TTL_SECONDS,
    });
    return NextResponse.json({ data: {
      repository: { externalId: result.repository.externalId, fullName: result.repository.fullName, defaultBranch: result.repository.defaultBranch, headSha: result.headSha },
      firstParentCommitCount: result.firstParentCommitCount, headFileCount: result.headFileCount,
      appRootCandidates: result.candidates, limits, preflightToken,
    } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
