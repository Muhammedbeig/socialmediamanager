import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { facebookAuth } from "@/connectors/facebook/auth";
import { instagramAuth } from "@/connectors/instagram/auth";
import { instagramDirectAuth } from "@/connectors/instagram/login";
import { metaRequest } from "@/connectors/meta/http";
import { threadsAuth } from "@/connectors/threads/auth";
import { ConnectorError } from "@/connectors/types";

// No real network: `fetch` is replaced and answers from a script.
type Call = { url: URL; method: string; body: URLSearchParams | null; bearer: string | null };
let calls: Call[];
let answers: { status?: number; body: unknown }[];

beforeEach(() => {
  calls = [];
  answers = [];
  for (const name of ["FACEBOOK", "THREADS", "INSTAGRAM"]) {
    process.env[`${name}_APP_ID`] = `${name.toLowerCase()}-app-id`;
    process.env[`${name}_APP_SECRET`] = `${name.toLowerCase()}-app-secret`;
  }
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    calls.push({
      url: new URL(String(input)),
      method: init.method ?? "GET",
      body: init.body instanceof URLSearchParams ? init.body : null,
      bearer: headers.get("Authorization")?.replace("Bearer ", "") ?? null,
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`Unexpected request to ${String(input)}`);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const REDIRECT = "https://localhost:3000/api/channels/callback/x";

describe("Unified login (Instagram directly)", () => {
  beforeEach(() => {
    process.env.INSTAGRAM_LOGIN_CONFIG_ID = "config-1";
  });

  it("sends the Member to Facebook Login for Business with the configuration, not scopes", () => {
    const url = new URL(instagramDirectAuth.authorizeUrl({ redirectUri: REDIRECT, state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v27.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("facebook-app-id");
    expect(url.searchParams.get("config_id")).toBe("config-1");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("makes one Channel target per shared Instagram account, with the never-expiring business token", async () => {
    answers.push(
      { body: { access_token: "system-user-token" } },
      {
        body: {
          data: [{ id: "17841400000", username: "acme", name: "Acme" }],
          paging: { next: "https://graph.facebook.com/v27.0/next-accounts" },
        },
      },
      { body: { data: [{ id: "17841400001", username: "acme.outlet" }] } },
    );

    const targets = await instagramDirectAuth.exchangeCode({ code: "the-code", redirectUri: REDIRECT });

    expect(calls[0].url.pathname).toBe("/v27.0/oauth/access_token");
    expect(calls[0].url.searchParams.get("client_secret")).toBe("facebook-app-secret");
    expect(calls[0].url.searchParams.get("code")).toBe("the-code");
    expect(calls[1].url.pathname).toBe("/v27.0/me/assigned_instagram_accounts");
    expect(calls[1].url.searchParams.get("access_token")).toBe("system-user-token");
    expect(targets).toEqual([
      { externalId: "17841400000", displayName: "Acme", handle: "acme", accessToken: "system-user-token", expiresAt: null },
      {
        externalId: "17841400001",
        displayName: "acme.outlet",
        handle: "acme.outlet",
        accessToken: "system-user-token",
        expiresAt: null,
      },
    ]);
  });
});

describe("Facebook login", () => {
  it("sends the Member to Facebook asking for the Page permissions", () => {
    const url = new URL(facebookAuth.authorizeUrl({ redirectUri: REDIRECT, state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v27.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("facebook-app-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("scope")).toContain("pages_manage_posts");
  });

  it("turns every granted Page into a Channel target with its own Page token", async () => {
    answers.push(
      { body: { access_token: "short-user" } },
      { body: { access_token: "long-user" } },
      {
        body: {
          data: [{ id: "111", name: "Acme", access_token: "page-token-111" }],
          paging: { next: "https://graph.facebook.com/v27.0/next-page" },
        },
      },
      { body: { data: [{ id: "222", name: "Acme Outlet", access_token: "page-token-222" }] } },
    );

    const targets = await facebookAuth.exchangeCode({ code: "the-code", redirectUri: REDIRECT });

    expect(targets).toEqual([
      { externalId: "111", displayName: "Acme", handle: null, accessToken: "page-token-111", expiresAt: null },
      { externalId: "222", displayName: "Acme Outlet", handle: null, accessToken: "page-token-222", expiresAt: null },
    ]);
    expect(calls[0].url.searchParams.get("code")).toBe("the-code");
    expect(calls[1].url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(calls[1].url.searchParams.get("fb_exchange_token")).toBe("short-user");
    expect(calls[2].url.pathname).toBe("/v27.0/me/accounts");
    expect(calls[2].url.searchParams.get("access_token")).toBe("long-user");
  });
});

describe("Instagram login (through Facebook Login)", () => {
  it("asks for the Instagram publishing and delete permissions", () => {
    const url = new URL(instagramAuth.authorizeUrl({ redirectUri: REDIRECT, state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v27.0/dialog/oauth");
    const scopes = url.searchParams.get("scope")!.split(",");
    expect(scopes).toEqual(
      expect.arrayContaining(["instagram_basic", "instagram_content_publish", "instagram_manage_contents"]),
    );
  });

  it("makes one Channel per Instagram profile linked to a granted Page, with that Page's token", async () => {
    answers.push(
      { body: { access_token: "short-user" } },
      { body: { access_token: "long-user" } },
      {
        body: {
          data: [
            {
              id: "111",
              name: "Acme",
              access_token: "page-token-111",
              instagram_business_account: { id: "1784000", username: "acme", name: "Acme Shop" },
            },
            { id: "222", name: "No Instagram here", access_token: "page-token-222" },
          ],
        },
      },
    );
    const targets = await instagramAuth.exchangeCode({ code: "the-code", redirectUri: REDIRECT });
    expect(targets).toEqual([
      { externalId: "1784000", displayName: "Acme Shop", handle: "acme", accessToken: "page-token-111", expiresAt: null },
    ]);
    expect(calls[2].url.searchParams.get("fields")).toContain("instagram_business_account");
  });
});

describe("Threads login", () => {
  it("asks for publish and delete permissions", () => {
    const url = new URL(threadsAuth.authorizeUrl({ redirectUri: REDIRECT, state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://threads.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("threads_basic,threads_content_publish,threads_delete");
  });

  it("connects one profile with a long-lived token", async () => {
    answers.push(
      { body: { access_token: "short-th", user_id: 12345 } },
      { body: { access_token: "long-th", expires_in: 5_183_944 } },
      { body: { id: "12345", username: "acme.threads" } },
    );
    const [target] = await threadsAuth.exchangeCode({ code: "th-code", redirectUri: REDIRECT });
    expect(target).toMatchObject({
      externalId: "12345",
      displayName: "acme.threads",
      handle: "acme.threads",
      accessToken: "long-th",
    });
    expect(calls[0].url.href).toBe("https://graph.threads.com/oauth/access_token");
    expect(calls[0].body?.get("client_secret")).toBe("threads-app-secret");
    expect(calls[1].url.searchParams.get("grant_type")).toBe("th_exchange_token");
    expect(calls[2].url.searchParams.get("access_token")).toBe("long-th");
  });

  it("refreshes a long-lived token", async () => {
    answers.push({ body: { access_token: "fresh-th", expires_in: 5_183_944 } });
    const refreshed = await threadsAuth.refresh!("long-th");
    expect(refreshed.accessToken).toBe("fresh-th");
    expect(calls[0].url.pathname).toBe("/refresh_access_token");
    expect(calls[0].url.searchParams.get("grant_type")).toBe("th_refresh_token");
  });
});

/** Resolves with the error a request was expected to fail with. */
async function failure(request: Promise<unknown>): Promise<ConnectorError> {
  try {
    await request;
  } catch (error) {
    return error as ConnectorError;
  }
  throw new Error("Expected the request to fail.");
}

describe("Meta error handling", () => {
  it("reports an expired token as an auth error", async () => {
    answers.push({ status: 400, body: { error: { message: "Session has expired", type: "OAuthException", code: 190 } } });
    const error = await failure(metaRequest("https://graph.facebook.com/v27.0/me"));
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.kind).toBe("auth");
  });

  it("reports rate limits and server errors as retryable", async () => {
    answers.push({ status: 400, body: { error: { message: "Too many calls", code: 4 } } });
    answers.push({ status: 503, body: {} });
    const limited = await failure(metaRequest("https://graph.facebook.com/v27.0/me"));
    const down = await failure(metaRequest("https://graph.facebook.com/v27.0/me"));
    expect(limited.kind).toBe("retryable");
    expect(down.kind).toBe("retryable");
  });

  it("reports refused content as rejected", async () => {
    answers.push({ status: 400, body: { error: { message: "Invalid parameter", code: 100 } } });
    const error = await failure(metaRequest("https://graph.facebook.com/v27.0/me"));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("Invalid parameter");
  });

  it("treats no answer as retryable, or outcome unknown when something may have been published", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const read = await failure(metaRequest("https://graph.facebook.com/v27.0/me"));
    const publish = await failure(metaRequest("https://graph.facebook.com/v27.0/1/feed", {
      method: "POST",
      onNoAnswer: "outcome_unknown",
    }));
    expect(read.kind).toBe("retryable");
    expect(publish.kind).toBe("outcome_unknown");
  });
});
