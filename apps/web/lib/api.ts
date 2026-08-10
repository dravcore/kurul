export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

/** Nest `AllExceptionsFilter` JSON body. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    super(message);
    this.name = 'ApiError';
    this.statusCode = body.statusCode;
    this.body = body;
  }
}

/** The HTTP status behind a failure, or `null` when it never reached one (network, abort). */
export function apiStatus(caught: unknown): number | null {
  return caught instanceof ApiError ? caught.statusCode : null;
}

/**
 * The slice of a next-intl translator this module needs — narrowed to a plain function so
 * the mapping stays testable without standing up an intl provider.
 */
export type ApiMessageTranslator = (key: string) => string;

/** Translation keys explaining one failed request, keyed by the status that produced it. */
export interface ApiMessageKeys {
  /** Used when no status matches — including a network error, which carries no status. */
  fallback: string;
  /** HTTP status → translation key, e.g. `{ 403: 'forbidden' }`. */
  byStatus?: Readonly<Partial<Record<number, string>>>;
}

/**
 * Turns a caught request failure into the message shown to the user.
 *
 * Every screen was re-deriving the same thing from `caught instanceof ApiError &&
 * caught.statusCode === 403`, which is how a permission failure ends up reported as a
 * generic "could not save" on the one screen that forgot the check. Keys are resolved
 * relative to whatever namespace `t` was created for.
 *
 * Callers that need more than wording out of the status — closing a panel on 404, offering
 * a retry only for unexplained failures — should branch on {@link apiStatus} instead.
 */
export function resolveApiMessage(
  caught: unknown,
  t: ApiMessageTranslator,
  keys: ApiMessageKeys,
): string {
  const status = apiStatus(caught);
  const key = (status === null ? undefined : keys.byStatus?.[status]) ?? keys.fallback;
  return t(key);
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = {
      statusCode: response.status,
      error: response.statusText || 'Error',
      message: `Request failed with status ${response.status}`,
    };
  }
  return new ApiError({
    statusCode: body.statusCode ?? response.status,
    error: body.error ?? 'Error',
    message: body.message ?? `Request failed with status ${response.status}`,
  });
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Typed Nest API client used by the web app. */
export const api = {
  get<T>(path: string, init?: RequestInit): Promise<T> {
    return request<T>(path, { ...init, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return request<T>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return request<T>(path, {
      ...init,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T = void>(path: string, init?: RequestInit): Promise<T> {
    return request<T>(path, { ...init, method: 'DELETE' });
  },
};
