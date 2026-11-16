import { ConnectorError, type ConnectorErrorKind } from "./types";

// Request helper for the APIs that are not Meta's (LinkedIn, Google). Errors are sorted the same
// way: an expired login, something worth retrying, or a refusal. Only the response body's message
// is reported, so a token in a URL is never logged.

export type ApiResponse<T> = { status: number; headers: Headers; body: T };

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as a form body. */
  form?: Record<string, string>;
  /** Sent as raw bytes. */
  body?: BodyInit;
  timeoutMs?: number;
  /** What a missing answer means; a call that may have published something passes "outcome_unknown". */
  onNoAnswer?: Extract<ConnectorErrorKind, "retryable" | "outcome_unknown">;
  /** Statuses that are not errors here, such as 308 during a resumable upload. */
  acceptStatus?: number[];
};

type ErrorBody = {
  message?: string;
  error?: string | { message?: string; status?: string; errors?: { reason?: string }[] };
  error_description?: string;
  serviceErrorCode?: number;
};

function messageOf(body: unknown, status: number): string {
  if (!body || typeof body !== "object") return `The network answered with HTTP ${status}.`;
  const error = body as ErrorBody;
  if (typeof error.error === "object" && error.error?.message) return error.error.message;
  return error.error_description ?? error.message ?? (typeof error.error === "string" ? error.error : null) ?? `The network answered with HTTP ${status}.`;
}

/** Quota reasons that a retry within minutes cannot fix. */
const QUOTA_REASONS = new Set(["quotaExceeded", "uploadLimitExceeded", "dailyLimitExceeded"]);

export async function apiRequest<T = unknown>(url: string | URL, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = "GET", timeoutMs = 60_000, onNoAnswer = "retryable" } = options;
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = new URLSearchParams(options.form);
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  } catch (cause) {
    throw new ConnectorError(onNoAnswer, "The network did not answer.", { cause });
  }

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: keep the text.
  }

  const ok = (response.status >= 200 && response.status < 300) || options.acceptStatus?.includes(response.status);
  if (ok) return { status: response.status, headers: response.headers, body: parsed as T };

  const message = messageOf(parsed, response.status);
  const reasons =
    typeof (parsed as ErrorBody)?.error === "object"
      ? (((parsed as ErrorBody).error as { errors?: { reason?: string }[] }).errors ?? []).map((e) => e.reason)
      : [];
  let kind: ConnectorErrorKind = "rejected";
  if (response.status === 401) kind = "auth";
  else if (reasons.some((reason) => reason && QUOTA_REASONS.has(reason))) kind = "rejected";
  else if (response.status === 429 || response.status >= 500) kind = "retryable";
  throw new ConnectorError(kind, `${message} (HTTP ${response.status})`);
}
