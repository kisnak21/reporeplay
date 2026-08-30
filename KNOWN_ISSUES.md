# Known Tooling Issues

## Prisma CLI audit advisory

`npm audit` reports `GHSA-ggr8-5vv4-36mx` through `prisma -> @prisma/config -> deepmerge-ts` in the development CLI dependency graph.

The available automated remediation downgrades Prisma across a major-version boundary. Phase 0 does not apply that breaking change. Reassess when Prisma publishes a compatible dependency update. Runtime application code does not import `@prisma/config`.
