import { ConnectorError, type ConnectorErrorKind } from "../types";

// Shared request helper for Facebook, Instagram and Threads (all Meta Graph-style APIs).
// Error messages come from Meta's response body only, so a token in a URL is never logged.

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
    error_user_msg?: string;
  };
  // Instagram's token endpoint uses a flat shape.
  error_type?: string;
  error_message?: string;
  code?: number;
};

// "Try again later" codes: unknown error, service down, app/user/page rate limits.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
// Token expired, revoked, or the session is invalid.
const AUTH_CODES = new Set([102, 190]);

export type MetaRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  /** Sent as a form body. */
  form?: Record<string, string>;
  /** Sent as an `Authorization: Bearer` header. */
  bearer?: string;
  timeoutMs?: number;
  /**
   * What a missing answer means. Reads and idempotent calls are "retryable".
   * A call that may have published something must pass "outcome_unknown".
   */
  onNoAnswer?: Extract<ConnectorErrorKind, "retryable" | "outcome_unknown">;
};

export async function metaRequest<T>(url: string | URL, options: MetaRequestOptions = {}): Promise<T> {
  const { method = "GET", form, bearer, timeoutMs = 30_000, onNoAnswer = "retryable" } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new ConnectorError(onNoAnswer, "The network did not answer.", { cause });
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const errorBody = body as MetaErrorBody;
  if (response.ok && !errorBody.error && !errorBody.error_type) return body as T;

  const code = errorBody.error?.code ?? errorBody.code;
  const message =
    errorBody.error?.error_user_msg ??
    errorBody.error?.message ??
    errorBody.error_message ??
    `The network answered with HTTP ${response.status}.`;

  let kind: ConnectorErrorKind = "rejected";
  if (code !== undefined && AUTH_CODES.has(code)) kind = "auth";
  else if (
    errorBody.error?.is_transient ||
    (code !== undefined && RETRYABLE_CODES.has(code)) ||
    response.status === 429 ||
    response.status >= 500
  ) {
    kind = "retryable";
  }
  throw new ConnectorError(kind, code !== undefined ? `${message} (code ${code})` : message);
}

export function expiresAtFrom(expiresInSeconds: number | undefined, now = new Date()): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(now.getTime() + expiresInSeconds * 1000);
}
