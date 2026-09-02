import { timingSafeEqual } from "node:crypto";

export function hasAdminBearerToken(request: Request, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const presentedToken = authorization.slice("Bearer ".length);
  const expected = Buffer.from(expectedToken);
  const presented = Buffer.from(presentedToken);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
