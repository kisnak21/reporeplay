interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

interface ApiResponse<T> extends ApiErrorBody {
  data?: T;
}

export class ApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function fetchApi<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok) throw new ApiError(body?.error?.message ?? "The request could not be completed.", body?.error?.code);
  if (body?.data === undefined) throw new ApiError("The API returned an incomplete response.");
  return body.data;
}
