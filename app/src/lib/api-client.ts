// Shared fetch mutator used by all Orval-generated endpoints.
// Cookie-based auth: `credentials: "include"` sends the session cookie to the API.
// Fail at load rather than letting an unset var produce a `undefined/...`
// URL, which resolves against the dev server and 404s confusingly.
const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  throw new Error(
    "VITE_API_URL is not set — set it in .env.development / .env.production"
  );
}

const baseURL = `${apiUrl}/app`;

// Error thrown for non-2xx responses: HTTP `status` and the parsed response
// `data`. Network failures (no response) surface as the native fetch
// `TypeError` instead.
export class ApiError<TData = unknown> extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data: TData
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export function getApiErrorMessage(
  err: unknown,
  fallback = "An unexpected error occurred"
): string {
  if (err instanceof ApiError && err.data && typeof err.data === "object") {
    const dataObj = err.data as Record<string, unknown>;
    const message = dataObj["message"];
    if (typeof message === "string" && message) {
      return message;
    }
    const detail = dataObj["detail"];
    if (typeof detail === "string" && detail) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first === "object" && first && "msg" in first) {
        return String((first as { msg: unknown })["msg"]);
      }
    }
  } else if (
    err &&
    typeof err === "object" &&
    "response" in err &&
    (err as { response?: { data?: { message?: string } } })["response"]?.data
      ?.message
  ) {
    return (err as { response: { data: { message: string } } })["response"].data
      .message;
  } else if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

const parseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return undefined;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return contentType.includes("application/json") ? JSON.parse(text) : text;
};

// Orval `fetch` httpClient calls this with the request path and a RequestInit
// (method, headers, body, signal). We prepend the base URL, attach credentials,
// parse the body, and throw `ApiError` on non-2xx so TanStack Query treats it
// as an error.
export const customInstance = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  const response = await fetch(`${baseURL}${url}`, {
    ...options,
    credentials: "include",
  });

  const data = await parseBody(response);

  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !url.includes("/login") &&
      !url.includes("/create-account") &&
      !url.includes("/signup") &&
      !url.includes("/invitations/")
    ) {
      const pathname = window.location.pathname;
      const isPublic =
        pathname === "/login" ||
        pathname === "/signup" ||
        pathname === "/create-account" ||
        pathname.startsWith("/accept-invite");
      if (!isPublic) {
        window.location.href = "/login";
      }
    }
    throw new ApiError(response.status, response.statusText, data);
  }

  return data as T;
};

export default customInstance;

// Error type surfaced on generated hooks (e.g. useQuery error is ApiError<TError>).
export type ErrorType<TError> = ApiError<TError>;

// Body type helper for generated mutation inputs.
export type BodyType<TBody> = TBody;
