import { ApiError, fetchApi } from "@/lib/client-api";

export function createMutationRequest() {
  let pending: { fingerprint: string; key: string } | null = null;
  return async function mutate<T>(url: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? "POST";
    const fingerprint = JSON.stringify([url, method, init.body ?? null]);
    if (pending?.fingerprint !== fingerprint) pending = { fingerprint, key: crypto.randomUUID() };
    const attempt = pending;
    const headers = new Headers(init.headers);
    headers.set("Idempotency-Key", attempt.key);
    try {
      const result = await fetchApi<T>(url, { ...init, method, headers });
      if (pending === attempt) pending = null;
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === "IDEMPOTENCY_KEY_CONFLICT" && pending === attempt) pending = null;
      throw error;
    }
  };
}
