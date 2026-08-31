import { RepoReplayError } from "./errors";

export interface GitHubRepositoryRef { provider: "GITHUB"; owner: string; name: string; fullName: string; canonicalUrl: string; identityKey: string }

const segmentPattern = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepositoryUrl(value: string): GitHubRepositoryRef {
  let url: URL;
  try { url = new URL(value); } catch { throw invalidUrl(); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash || url.port) throw invalidUrl();
  const rawPath = url.pathname;
  if (rawPath.toLowerCase().includes("%2f")) throw invalidUrl();
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(rawPath); } catch { throw invalidUrl(); }
  if (decodedPath.includes("//")) throw invalidUrl();
  const parts = decodedPath.split("/").filter(Boolean);
  if (parts.length !== 2) throw invalidUrl();
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, "");
  if (!owner || !name || !segmentPattern.test(owner) || !segmentPattern.test(name)) throw invalidUrl();
  const fullName = `${owner}/${name}`;
  return { provider: "GITHUB", owner, name, fullName, canonicalUrl: `https://github.com/${fullName}`, identityKey: fullName.toLowerCase() };
}

function invalidUrl(): RepoReplayError { return new RepoReplayError("INVALID_REPOSITORY_URL", "Enter a public GitHub repository URL in the form github.com/owner/repository."); }
