import { parseEnvironment } from "../src/lib/environment";

async function startWorker(): Promise<void> {
  const environment = parseEnvironment(process.env);
  process.stdout.write(`RepoReplay worker ready; poll interval ${environment.WORKER_POLL_INTERVAL_MS}ms\n`);
}

startWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker startup failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
