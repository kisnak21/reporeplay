export type WorkerLogLevel = "info" | "warn" | "error";

export interface WorkerLogContext {
  workerId?: string;
  processVersion?: string;
  jobId?: string;
  runId?: string;
  leaseGeneration?: number;
  attemptCount?: number;
  maxAttempts?: number;
  errorCode?: string;
  errorType?: string;
  resultStatus?: "RETRYABLE" | "FAILED" | "LEASE_LOST" | "WAITING_RATE_LIMIT" | "CANCELLED";
  nextAttemptAt?: string;
  shutdownSignal?: "SIGINT" | "SIGTERM";
}

export function formatWorkerLog(
  level: WorkerLogLevel,
  event: string,
  context: WorkerLogContext = {},
  timestamp = new Date(),
): string {
  return `${JSON.stringify({
    ...context,
    timestamp: timestamp.toISOString(),
    level,
    service: "reporeplay-worker",
    event,
  })}\n`;
}

export function writeWorkerLog(
  level: WorkerLogLevel,
  event: string,
  context: WorkerLogContext = {},
): void {
  const line = formatWorkerLog(level, event, context);
  const output = level === "error" ? process.stderr : process.stdout;
  output.write(line);
}
