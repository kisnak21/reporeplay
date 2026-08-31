import { createPrivateKey, createSign } from "node:crypto";

export interface AppAuth {
  appId: string;
  privateKey: string;
  installationId: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes("\\n")) return trimmed.replace(/\\n/g, "\n");
  return trimmed;
}

export async function createAppJwt(appId: string, privateKey: string): Promise<string> {
  const normalized = normalizePrivateKey(privateKey);
  const keyObject = createPrivateKey(normalized);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(keyObject, "base64url");
  return `${data}.${signature}`;
}

export async function getInstallationToken(auth: AppAuth, fetchImpl: typeof fetch = fetch): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.token;
  const jwt = await createAppJwt(auth.appId, auth.privateKey);
  const response = await fetchImpl(`https://api.github.com/app/installations/${auth.installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "reporeplay",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub App token failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  cachedToken = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
  return data.token;
}

export function clearTokenCache(): void {
  cachedToken = null;
}
