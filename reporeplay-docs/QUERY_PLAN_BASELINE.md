# Query Plan Baseline

Measured on 2026-09-13 against a dedicated PostgreSQL 18.6 database. The application database was not used.

## Dataset and method

The synthetic dataset contains 100 repositories and active runs, 50,000 commits, and 272,500 changed-file rows. Each run has 500 commits. One stress run has 25,000 changed-file rows (50 per commit); the other runs have five per commit. Category, route, dependency, and warning rows exercise the timeline's correlated lookups.

Each query used `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, with one warm-up followed by five measured executions. Reported latency is the median on a warm local cache. It is a comparison for this dataset, not a production latency target.

## Results

| Query | Median | Plan evidence |
|---|---:|---|
| Timeline first page | 0.33 ms | Reads 31 commits through `RunCommit_runId_sequence_key`; child summaries use run-commit indexes. |
| Category filter | 1.38 ms | Uses `CommitCategory_runId_category_idx` and the descending run/sequence index. |
| Path substring, 25,000-file stress run, before trigram | 39.0 ms | Scans 25,000 files from `CommitFile_runId_path_idx`, then applies the substring test. |
| Path substring, same run, with migrated trigram index | 1.65 ms | Combines the trigram index with the run/path index; shared-hit blocks fall from 27,525 to 239. |
| Previous-path substring on five synthetic renames | 0.20 ms | Uses the same composite GIN index for the `previousPath` branch. |
| Message substring | 0.65 ms | Checks at most 500 commits using the run/sequence index. A candidate message trigram index measured 0.18 ms and added a 1.6 MB index. |
| Route event filter | 0.18 ms | Uses `RouteChange_runId_route_idx` and commit ID lookups. |
| Dependency event filter | 0.08 ms | Uses `DependencyChange_runId_packageName_idx` and run/commit lookups. |
| Date range | 0.09 ms | Uses `RunCommit_runId_committedAt_sequence_idx`. |
| Commit detail: 50 files | 0.10 ms | Uses the existing `CommitFile_runCommitId_path_status_key` index. |

The matched path before/after timings use ten matching commits and the same rows. Five synthetic rename rows were added afterward to verify the `previousPath` branch separately. The migrated composite GIN index occupied 7.3 MiB across 272,500 changed-file rows. The path filter's worst-case scan dropped about 24 times in latency and 115 times in shared-hit blocks. The message index was not selected for implementation: the absolute time saved was small and each run is capped at 500 commits.

## Decision

Add a composite `gin_trgm_ops` GIN index for `CommitFile.path` and `CommitFile.previousPath`. Keep the existing B-tree indexes for run-scoped lookups and ordering. Do not add a message trigram index unless production measurements show message search has become a bottleneck.

Production-like load, write overhead, and storage growth still need measurement after a showcase repository is selected.
