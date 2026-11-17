# 8. Instagram Channels connect through Facebook or directly

Date: 2026-11-17. Amends [0005](0005-instagram-through-facebook-login.md).

## Decision

Instagram has two ways to connect, both making ordinary Instagram Channels on the one Instagram
Connector:

- **Through Facebook** (Facebook Login, as in 0005): for profiles linked to a Facebook Page.
  Publishes on `graph.facebook.com` with the Page token and can remove posts.
- **Directly** (Instagram Login, `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`): for any professional
  profile, no Page needed. Publishes on `graph.instagram.com` with the profile's token, which lasts
  60 days and is refreshed like Threads tokens.

The Channel's settings record which way it connected (`login: "facebook" | "instagram"`). The
Connector picks the host from that, and the registry uses it to reconnect and refresh the Channel
the same way. The profile ID is the same either way, so connecting the other way updates the same
Channel instead of making a second one.

## Why

- The owner wants profiles that are not linked to a Page to connect too.
- Meta's Instagram Media reference (checked 2026-11-17) still says deleting media "only supports
  Instagram API with Facebook login".

## Cost

- Directly connected Channels cannot be removed by the app. Their capabilities say
  `removal.manual`: Remove becomes "Mark removed", which records the Delivery as removed and tells
  the Member to delete the post in Instagram. Replace is not offered, since it would leave the old
  post live.
- A second Meta app ID and secret to keep, and an Instagram Tester invite per profile while the
  app is in development mode.
