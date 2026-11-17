import { requireEnv } from "@/env";
import { metaRequest } from "../meta/http";
import type { ChannelTarget, ConnectorAuth } from "../types";

// Facebook Login. One login can grant several Pages. Facebook Pages and Instagram (through the
// Pages its profiles are linked to) both connect this way.
// Checked against Meta's Pages API, long-lived token and Instagram docs on 2026-11-11.

export const FACEBOOK_GRAPH = "https://graph.facebook.com/v27.0";

type UserToken = { access_token: string };
export type PageEntry = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string; name?: string };
};
type PageList = { data: PageEntry[]; paging?: { next?: string } };

export function createFacebookLogin(options: {
  scopes: string[];
  pageFields: string;
  /** Turns each granted Page into Channel targets (none, or one). */
  toTargets(page: PageEntry): ChannelTarget[];
}): ConnectorAuth {
  return {
    authorizeUrl({ redirectUri, state }) {
      const url = new URL("https://www.facebook.com/v27.0/dialog/oauth");
      // Pages owned by a business portfolio are only listed with business_management, which makes
      // Facebook ask the Member to share a whole portfolio. Off unless FACEBOOK_BUSINESS_PAGES=1.
      const scopes =
        process.env.FACEBOOK_BUSINESS_PAGES === "1" ? [...options.scopes, "business_management"] : options.scopes;
      url.search = new URLSearchParams({
        client_id: requireEnv("FACEBOOK_APP_ID"),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: scopes.join(","),
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
      let next: string | undefined = `${FACEBOOK_GRAPH}/me/accounts?fields=${options.pageFields}&limit=100`;
      let accessToken: string | undefined = longLived.access_token;
      while (next) {
        const page: PageList = await metaRequest<PageList>(next, { accessToken });
        for (const item of page.data) targets.push(...options.toTargets(item));
        next = page.paging?.next;
        // The `next` link already carries the token.
        accessToken = undefined;
      }
      return targets;
    },
  };
}

export const facebookAuth = createFacebookLogin({
  scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement"],
  pageFields: "id,name,access_token",
  toTargets: (page) => [
    { externalId: page.id, displayName: page.name, handle: null, accessToken: page.access_token, expiresAt: null },
  ],
});
