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
// Plain words for codes Meta may send without a message.
const KNOWN_CODES: Record<number, string> = {
  368: "Facebook temporarily blocked this as possibly spam, often after several identical posts in a short time. Wait a while, change the text if you can, then Retry.",
};

export type MetaRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  /** Sent as a form body. */
  form?: Record<string, string>;
  /** Sent as a multipart body, for file uploads. */
  multipart?: FormData;
  /** Sent as an `Authorization: Bearer` header. */
  bearer?: string;
  /** Sent as the `access_token` parameter: in the query for GET and DELETE, in the body for POST. */
  accessToken?: string;
  timeoutMs?: number;
  /**
   * What a missing answer means. Reads and idempotent calls are "retryable".
   * A call that may have published something must pass "outcome_unknown".
   */
  onNoAnswer?: Extract<ConnectorErrorKind, "retryable" | "outcome_unknown">;
};

export async function metaRequest<T>(url: string | URL, options: MetaRequestOptions = {}): Promise<T> {
  const { method = "GET", bearer, accessToken, timeoutMs = 60_000, onNoAnswer = "retryable" } = options;
  const target = new URL(url);
  let body: URLSearchParams | FormData | undefined;
  if (options.multipart) {
    body = options.multipart;
    if (accessToken) body.set("access_token", accessToken);
  } else if (options.form || (accessToken && method === "POST")) {
    body = new URLSearchParams(options.form);
    if (accessToken && method === "POST") body.set("access_token", accessToken);
  }
  if (accessToken && method !== "POST") target.searchParams.set("access_token", accessToken);

  let response: Response;
  try {
    response = await fetch(target, {
      method,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new ConnectorError(onNoAnswer, "The network did not answer.", { cause });
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  const errorBody = parsed as MetaErrorBody;
  if (response.ok && !errorBody.error && !errorBody.error_type) return parsed as T;

  const code = errorBody.error?.code ?? errorBody.code;
  // Meta sometimes sends an empty message, so empty strings fall through too.
  const message =
    errorBody.error?.error_user_msg ||
    errorBody.error?.message ||
    errorBody.error_message ||
    (code !== undefined && KNOWN_CODES[code]) ||
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

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Instagram and Threads process media in a "container" before it can be published. */
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/**
 * Waits until a container is ready. Gives up after `maxMs` with a retryable error, so the
 * Delivery's next attempt can pick the same container up again.
 */
export async function waitForContainer(
  read: () => Promise<{ status: ContainerStatus; message?: string }>,
  options: { sleep: Sleep; intervalMs: number; maxMs: number; network: string },
): Promise<void> {
  let waited = 0;
  for (;;) {
    const { status, message } = await read();
    if (status === "FINISHED") return;
    if (status === "PUBLISHED") {
      throw new ConnectorError("outcome_unknown", `${options.network} says this was already published.`);
    }
    if (status === "ERROR") {
      throw new ConnectorError("rejected", `${options.network} could not process the media${message ? `: ${message}` : "."}`);
    }
    if (status === "EXPIRED") throw new ConnectorError("retryable", `${options.network} let the upload expire.`);
    if (waited >= options.maxMs) {
      throw new ConnectorError("retryable", `${options.network} is still processing the media.`);
    }
    await options.sleep(options.intervalMs);
    waited += options.intervalMs;
  }
}
