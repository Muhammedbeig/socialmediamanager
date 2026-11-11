import { metaRequest } from "../meta/http";
import { createProfileLoginAuth } from "../meta/profile-login";

// Checked against Meta's Threads API docs (get access tokens, long-lived tokens, delete posts)
// on 2026-11-11.

export const THREADS_GRAPH = "https://graph.threads.com/v1.0";

type ThreadsProfile = { id: string; username?: string; name?: string };

export const threadsAuth = createProfileLoginAuth({
  appIdEnv: "THREADS_APP_ID",
  appSecretEnv: "THREADS_APP_SECRET",
  authorizeUrl: "https://threads.com/oauth/authorize",
  codeTokenUrl: "https://graph.threads.com/oauth/access_token",
  exchangeUrl: "https://graph.threads.com/access_token",
  exchangeGrant: "th_exchange_token",
  refreshUrl: "https://graph.threads.com/refresh_access_token",
  refreshGrant: "th_refresh_token",
  // threads_delete is required for Removal.
  scopes: ["threads_basic", "threads_content_publish", "threads_delete"],
  async loadProfile(accessToken, userId) {
    const profile = await metaRequest<ThreadsProfile>(`${THREADS_GRAPH}/me?fields=id,username,name`, {
      bearer: accessToken,
    });
    const username = profile.username ?? null;
    return {
      externalId: String(profile.id ?? userId),
      displayName: profile.name || username || "Threads profile",
      handle: username,
    };
  },
});
