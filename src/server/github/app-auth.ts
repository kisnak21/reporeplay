import { SignJWT, importPKCS8 } from "jose";

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
  const key = await importPKCS8(normalizePrivateKey(privateKey), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 600)
    .setIssuer(appId)
    .sign(key);
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
