import { requireEnv } from "@/env";
import { metaRequest } from "../meta/http";
import type { ChannelTarget, ConnectorAuth } from "../types";

// Facebook Login. One login can grant several Pages; each Page becomes one Channel.
// Checked against Meta's Pages API and long-lived token docs on 2026-11-11.

export const FACEBOOK_GRAPH = "https://graph.facebook.com/v27.0";

const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement"];

type UserToken = { access_token: string };
type PageList = {
  data: { id: string; name: string; access_token: string }[];
  paging?: { next?: string };
};

export const facebookAuth: ConnectorAuth = {
  authorizeUrl({ redirectUri, state }) {
    const url = new URL("https://www.facebook.com/v27.0/dialog/oauth");
    url.search = new URLSearchParams({
      client_id: requireEnv("FACEBOOK_APP_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    }).toString();
    return url.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const appId = requireEnv("FACEBOOK_APP_ID");
    const appSecret = requireEnv("FACEBOOK_APP_SECRET");

    const codeUrl = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    codeUrl.search = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    }).toString();
    const shortLived = await metaRequest<UserToken>(codeUrl);

    const exchangeUrl = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    exchangeUrl.search = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLived.access_token,
    }).toString();
    const longLived = await metaRequest<UserToken>(exchangeUrl);

    // Page tokens made from a long-lived user token have no expiry date.
    const targets: ChannelTarget[] = [];
    let next: string | undefined = `${FACEBOOK_GRAPH}/me/accounts?fields=id,name,access_token&limit=100`;
    let bearer: string | undefined = longLived.access_token;
    while (next) {
      const page: PageList = await metaRequest<PageList>(next, { bearer });
      for (const item of page.data) {
        targets.push({
          externalId: item.id,
          displayName: item.name,
          handle: null,
          accessToken: item.access_token,
          expiresAt: null,
        });
      }
      next = page.paging?.next;
      // The `next` link already carries the token.
      bearer = undefined;
    }
    return targets;
  },
};
