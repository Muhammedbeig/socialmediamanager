import { requireEnv } from "@/env";
import { FACEBOOK_GRAPH } from "../facebook/auth";
import { metaRequest } from "../meta/http";
import type { ChannelTarget, ConnectorAuth } from "../types";

// Instagram API with Unified Login: connects Instagram professional accounts directly, with no
// Facebook Page (docs/adr/0008). It is Facebook Login for Business with a configuration
// (INSTAGRAM_LOGIN_CONFIG_ID) whose assets are Instagram accounts and whose permissions include
// instagram_content_publish and instagram_manage_contents. The Member picks a business portfolio
// and the Instagram accounts to share; the app gets a business integration system user token that
// never expires (set in the configuration). Meta offers this to newer apps instead of Instagram Login.
// Checked against Meta's "Instagram API with Unified Login" get-started and authentication docs
// on 2026-11-17.

type InstagramAccount = { id: string; username?: string; name?: string };
type AccountList = { data: InstagramAccount[]; paging?: { next?: string } };

export const instagramDirectAuth: ConnectorAuth = {
  authorizeUrl({ redirectUri, state }) {
    const url = new URL("https://www.facebook.com/v27.0/dialog/oauth");
    url.search = new URLSearchParams({
      client_id: requireEnv("FACEBOOK_APP_ID"),
      config_id: requireEnv("INSTAGRAM_LOGIN_CONFIG_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    }).toString();
    return url.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const tokenUrl = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: requireEnv("FACEBOOK_APP_ID"),
      client_secret: requireEnv("FACEBOOK_APP_SECRET"),
      redirect_uri: redirectUri,
      code,
    }).toString();
    const { access_token: token } = await metaRequest<{ access_token: string }>(tokenUrl);

    // `/me` is the business's system user, not a profile: the shared accounts are listed here.
    const targets: ChannelTarget[] = [];
    let next: string | undefined = `${FACEBOOK_GRAPH}/me/assigned_instagram_accounts?fields=id,username,name&limit=100`;
    let accessToken: string | undefined = token;
    while (next) {
      const page: AccountList = await metaRequest<AccountList>(next, { accessToken });
      for (const account of page.data) {
        targets.push({
          externalId: account.id,
          displayName: account.name || account.username || "Instagram profile",
          handle: account.username ?? null,
          accessToken: token,
          expiresAt: null,
        });
      }
      next = page.paging?.next;
      // The `next` link already carries the token.
      accessToken = undefined;
    }
    return targets;
  },
};
