import { metaRequest } from "../meta/http";
import { createProfileLoginAuth } from "../meta/profile-login";

// Instagram API with Instagram Login: connects an Instagram professional profile directly, with no
// Facebook Page (docs/adr/0008). Publishes on graph.instagram.com, but cannot delete posts.
// Checked against Meta's "Business Login for Instagram", content publishing and Instagram Media
// docs on 2026-11-17.

export const INSTAGRAM_GRAPH = "https://graph.instagram.com/v27.0";

/** Saved in a Channel's settings: which login an Instagram Channel connected with. */
export type InstagramLogin = "facebook" | "instagram";

export function instagramLoginOf(settings: Record<string, unknown>): InstagramLogin {
  return settings.login === "instagram" ? "instagram" : "facebook";
}

type InstagramProfile = { user_id?: string; id?: string; username?: string; name?: string };

export const instagramDirectAuth = createProfileLoginAuth({
  appIdEnv: "INSTAGRAM_APP_ID",
  appSecretEnv: "INSTAGRAM_APP_SECRET",
  authorizeUrl: "https://www.instagram.com/oauth/authorize",
  codeTokenUrl: "https://api.instagram.com/oauth/access_token",
  exchangeUrl: "https://graph.instagram.com/access_token",
  exchangeGrant: "ig_exchange_token",
  refreshUrl: "https://graph.instagram.com/refresh_access_token",
  refreshGrant: "ig_refresh_token",
  scopes: ["instagram_business_basic", "instagram_business_content_publish"],
  async loadProfile(accessToken, userId) {
    const answer = await metaRequest<InstagramProfile | { data: InstagramProfile[] }>(
      `${INSTAGRAM_GRAPH}/me?fields=user_id,username,name`,
      { bearer: accessToken },
    );
    const profile = "data" in answer ? answer.data[0] : answer;
    const username = profile.username ?? null;
    return {
      // `user_id` is the professional account ID the publishing endpoints take. It is the same ID
      // the Facebook route finds, so one profile stays one Channel whichever way it connects.
      externalId: String(profile.user_id ?? profile.id ?? userId),
      displayName: profile.name || username || "Instagram profile",
      handle: username,
    };
  },
});
