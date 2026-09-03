export interface DecodedTimelineCursor {
  runId: string;
  sequence: number;
}

export function encodeTimelineCursor(runId: string, sequence: number): string {
  return Buffer.from(`${runId}:${sequence}`).toString("base64url");
}

export function decodeTimelineCursor(cursor: string): DecodedTimelineCursor | null {
  try {
    const [runId, seqRaw] = Buffer.from(cursor, "base64url").toString().split(":");
    const sequence = Number(seqRaw);
    if (!runId || !Number.isInteger(sequence) || sequence < 0) return null;
    return { runId, sequence };
  } catch {
    return null;
  }
}
