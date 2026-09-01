interface ApiErrorBody {
  error?: { message?: string };
}

interface ApiResponse<T> extends ApiErrorBody {
  data?: T;
}

export async function fetchApi<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok) throw new Error(body?.error?.message ?? "The request could not be completed.");
  if (body?.data === undefined) throw new Error("The API returned an incomplete response.");
  return body.data;
}
