import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

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
}).refine(
  ({ JOB_HEARTBEAT_SECONDS, JOB_LEASE_SECONDS }) => JOB_HEARTBEAT_SECONDS < JOB_LEASE_SECONDS,
  { message: "JOB_HEARTBEAT_SECONDS must be less than JOB_LEASE_SECONDS" },
);

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(source);
}
