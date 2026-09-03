export interface CommitMessageParts {
  subject: string;
  body: string;
}

export function splitCommitMessage(message: string): CommitMessageParts {
  const [subject, ...bodyLines] = message.trim().split(/\r?\n/);
  return { subject: subject || "Commit message unavailable", body: bodyLines.join("\n").trim() };
}
