# 8. Instagram Channels connect through Facebook or directly

Date: 2026-11-17. Amends [0005](0005-instagram-through-facebook-login.md).

## Decision

Instagram has two ways to connect, both making ordinary Instagram Channels on the one Instagram
Connector, both publishing on `graph.facebook.com` with the Facebook app ID and secret:

- **Through Facebook** (Facebook Login, as in 0005): for accounts linked to a Facebook Page. Uses
  the Page token, with `instagram_manage_contents`, so the app can remove posts.
- **Directly** (Instagram API with Unified Login): for any professional account, no Page needed.
  Facebook Login for Business with a configuration (`INSTAGRAM_LOGIN_CONFIG_ID`) whose assets are
  Instagram accounts. The Member picks a business portfolio and the accounts to share; the app gets
  a business integration system user token that never expires and lists the accounts with
  `/me/assigned_instagram_accounts`.

The Channel's settings record which way it connected (`login: "facebook" | "direct"`). The
registry uses it to reconnect the Channel the same way. The account ID is the same either way, so
connecting the other way updates the same Channel instead of making a second one.

## Why

- The owner wants accounts that are not linked to a Page to connect too.
- Meta's older "Instagram API with Instagram Login" (graph.instagram.com, its own app ID and
  secret) is "not available for newer apps"; the App Dashboard offers Unified Login instead
  (seen 2026-11-17). Unified Login also needs no extra secret.
- Meta's Unified Login permissions list (checked 2026-11-17) has publishing but no delete
  permission, and deleting media needs `instagram_manage_contents`.

## Cost

- Directly connected Channels cannot be removed by the app. Their capabilities say
  `removal.manual`: Remove becomes "Mark removed", which records the Delivery as removed and tells
  the Member to delete the post in Instagram. Replace is not offered, since it would leave the old
  post live.
- Unified Login needs the Meta app to be owned by a business portfolio (connected:
  ProLearn Academy), and the Member to choose a portfolio when connecting.
- In development mode, each account needs an Instagram Tester invite on the app.
