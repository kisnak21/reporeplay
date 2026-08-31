import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const percentage = z.coerce.number().int().min(0).max(100);

export const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_APP_INSTALLATION_ID: z.string().min(1),
  MAX_FIRST_PARENT_COMMITS: positiveInteger.default(500),
  MAX_HEAD_FILES: positiveInteger.default(25_000),
  JOB_LEASE_SECONDS: positiveInteger.default(60),
  JOB_HEARTBEAT_SECONDS: positiveInteger.default(15),
  WORKER_POLL_INTERVAL_MS: positiveInteger.default(1_000),
  WORKER_CONCURRENCY: positiveInteger.default(2),
  WORKER_ID: z.string().optional(),
  WORKER_SWEEP_INTERVAL_MS: positiveInteger.default(5_000),
  WORKER_GRACEFUL_SHUTDOWN_MS: positiveInteger.default(30_000),
  JOB_RETRY_BASE_SECONDS: positiveInteger.default(5),
  JOB_RETRY_MAX_SECONDS: positiveInteger.default(3_600),
  JOB_RETRY_JITTER_PERCENT: percentage.default(20),
  QUEUE_LAG_WARN_SECONDS: positiveInteger.default(60),
}).superRefine((environment, context) => {
  if (environment.JOB_HEARTBEAT_SECONDS * 2 >= environment.JOB_LEASE_SECONDS) {
    context.addIssue({ code: "custom", message: "JOB_HEARTBEAT_SECONDS must be less than half of JOB_LEASE_SECONDS" });
  }
  if (environment.JOB_RETRY_BASE_SECONDS > environment.JOB_RETRY_MAX_SECONDS) {
    context.addIssue({ code: "custom", message: "JOB_RETRY_BASE_SECONDS must not exceed JOB_RETRY_MAX_SECONDS" });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(source);
}
