import { createFacebookLogin } from "../facebook/auth";

// Instagram API with Facebook Login (see docs/adr/0005). Each Instagram professional profile
// linked to a granted Facebook Page becomes one Channel, using that Page's token.
// Checked against Meta's content publishing and Instagram Media docs on 2026-11-11: only this
// login lets an app delete Instagram posts.

export const instagramAuth = createFacebookLogin({
  scopes: [
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_contents",
    "pages_show_list",
    "pages_read_engagement",
  ],
  pageFields: "id,name,access_token,instagram_business_account{id,username,name}",
  toTargets: (page) => {
    const profile = page.instagram_business_account;
    if (!profile) return [];
    return [
      {
        externalId: profile.id,
        displayName: profile.name || profile.username || `Instagram of ${page.name}`,
        handle: profile.username ?? null,
        accessToken: page.access_token,
        expiresAt: null,
      },
    ];
  },
});
