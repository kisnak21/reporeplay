# GitHub REST Request Budget

This baseline measures the repository API calls made by preflight and history processing. It uses `GitHubAppSource` with an injected fixture fetch, so the tests make no network requests and do not consume a GitHub rate limit.

## Fixture results

| Fixture | Commits | Files at HEAD | App manifests | Dependency changes | Preflight | Preflight + processing |
|---|---:|---:|---:|---:|---:|---:|
| Linear | 2 | 10 | 2 | 1 | 7 | Not measured |
| Showcase-sized | 184 | 3,210 | 2 | 2 | 189 | 561 |

The showcase-sized run uses one selected app root, two changed dependency manifests in its history, and a route-tree request for each commit. It models the request shape at this size; it is not an import of a selected public showcase repository.

For the 184-commit fixture, preflight makes 1 repository request, 1 branch-ref request, 184 commit requests, 1 recursive HEAD-tree request, and 2 manifest-content requests. The 184 commit requests include the HEAD detail already fetched for its tree SHA plus the 183 ancestors. Reusing that HEAD detail avoids fetching the same commit twice during preflight traversal.

History processing then makes 184 commit requests, 184 recursive tree requests for route detection, and 4 content requests to compare current and parent versions for the two changed manifests. Together, preflight and processing make 561 core REST requests. The fixture test asserts these resource counts independently.

The two-commit fixture asserts 7 preflight requests: 1 repository, 1 ref, 2 commits including the reused HEAD detail, 1 tree, and 2 manifest contents.

## Estimate and limits

For these code paths, the measured request shape is:

```text
preflight = N + A + 3
processing = N + R + 2D + P
combined = 2N + R + A + 2D + P + 3
```

`N` is the first-parent commit count, `A` is the number of candidate manifests read in the HEAD tree, `R` is the number of commits whose trees are read for route detection (normally `N`), `D` is the number of selected-root manifest changes compared, and `P` is extra commit-detail pages followed through GitHub `Link` headers. The fixture has `N=184`, `A=2`, `R=184`, `D=2`, and `P=0`, giving 561.

The request count does not grow with the number of unchanged files in the HEAD tree; tree response size and parsing work do. Actual repositories can differ in app-manifest count, changed manifests, commit-file pagination, retry behavior, and GitHub responses. The baseline excludes GitHub App installation-token exchange, `/rate_limit`, database and web/worker control-plane operations, and retries. Token exchanges happen outside these core REST counts and may occur once for each cold web or worker process.

## Remaining measurement

After a public showcase repository is selected and imported in a configured environment, record the observed request/rate-limit delta alongside its commit count, HEAD file count, candidate manifest count, changed-manifest count, and pagination/retry events. Keep that observation separate from this deterministic fixture baseline.
