import { requireEnv } from "@/env";
import type { ChannelTarget, ConnectorAuth } from "../types";
import { expiresAtFrom, metaRequest } from "./http";

// Instagram Login and Threads Login work the same way: a code is traded for a short-lived
// token (1 hour), which is traded for a long-lived one (60 days) that can be refreshed.
// One login connects one profile, which becomes one Channel.

type ShortLivedToken = { access_token: string; user_id: string | number };
type LongLivedToken = { access_token: string; expires_in?: number };

export type ProfileLoginConfig = {
  appIdEnv: string;
  appSecretEnv: string;
  authorizeUrl: string;
  /** POST: code for a short-lived token. */
  codeTokenUrl: string;
  /** GET: short-lived for long-lived. */
  exchangeUrl: string;
  exchangeGrant: string;
  /** GET: extend a long-lived token. */
  refreshUrl: string;
  refreshGrant: string;
  scopes: string[];
  /** Read the profile behind a token. */
  loadProfile(accessToken: string, userId: string): Promise<Omit<ChannelTarget, "accessToken" | "expiresAt">>;
};

export function createProfileLoginAuth(config: ProfileLoginConfig): ConnectorAuth {
  return {
    authorizeUrl({ redirectUri, state }) {
      const url = new URL(config.authorizeUrl);
      url.search = new URLSearchParams({
        client_id: requireEnv(config.appIdEnv),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: config.scopes.join(","),
        state,
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const answer = await metaRequest<ShortLivedToken | { data: ShortLivedToken[] }>(config.codeTokenUrl, {
        method: "POST",
        form: {
          client_id: requireEnv(config.appIdEnv),
          client_secret: requireEnv(config.appSecretEnv),
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          // Meta appends "#_" to the redirect; it is not part of the code.
          code: code.replace(/#_$/, ""),
        },
      });
      // Instagram wraps the answer in a `data` array; Threads does not.
      const shortLived = "data" in answer ? answer.data[0] : answer;

      const exchangeUrl = new URL(config.exchangeUrl);
      exchangeUrl.search = new URLSearchParams({
        grant_type: config.exchangeGrant,
        client_secret: requireEnv(config.appSecretEnv),
        access_token: shortLived.access_token,
      }).toString();
      const longLived = await metaRequest<LongLivedToken>(exchangeUrl);

      const profile = await config.loadProfile(longLived.access_token, String(shortLived.user_id));
      return [
        {
          ...profile,
          accessToken: longLived.access_token,
          expiresAt: expiresAtFrom(longLived.expires_in),
        },
      ];
    },

    async refresh(accessToken) {
      const url = new URL(config.refreshUrl);
      url.search = new URLSearchParams({
        grant_type: config.refreshGrant,
        access_token: accessToken,
      }).toString();
      const refreshed = await metaRequest<LongLivedToken>(url);
      return { accessToken: refreshed.access_token, expiresAt: expiresAtFrom(refreshed.expires_in) };
    },
  };
}
