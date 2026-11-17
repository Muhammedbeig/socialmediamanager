# 8. Instagram Channels connect through Facebook or directly

Date: 2026-11-17. Amends [0005](0005-instagram-through-facebook-login.md).

## Decision

Instagram has two ways to connect, both making ordinary Instagram Channels on the one Instagram
Connector, both publishing on `graph.facebook.com` with the Facebook app ID and secret:

- **Through Facebook** (Facebook Login, as in 0005): for accounts linked to a Facebook Page. Uses
  the Page token.
- **Directly** (Instagram API with Unified Login): for any professional account in one of the
  Member's business portfolios, no Page needed. Facebook Login for Business with a configuration
  (`INSTAGRAM_LOGIN_CONFIG_ID`) whose only assets are Instagram accounts. The Member picks a
  business portfolio and the accounts to share; the app gets a business integration system user
  token that never expires and lists the accounts with `/me/assigned_instagram_accounts`.

Both tokens carry `instagram_content_publish` and `instagram_manage_contents`, so publishing,
Replace and Removal behave the same. The Channel's settings record which way it connected
(`login: "facebook" | "direct"`), and the registry uses it to reconnect the Channel the same way.
The account ID is the same either way, so connecting the other way updates the same Channel.

## Why

- The owner wants accounts that are not linked to a Page to connect too.
- Meta's older "Instagram API with Instagram Login" (graph.instagram.com, its own app ID and
  secret) is "not available for newer apps", and it cannot delete media. The App Dashboard offers
  Unified Login instead (seen 2026-11-17), which needs no extra secret.
- The configuration editor offers `instagram_manage_contents` for Unified Login, although Meta's
  Unified Login permissions page does not list it ("isn't exhaustive").

## Cost

- Unified Login needs the Meta app to be owned by a business portfolio (ProLearn Academy), and
  the Instagram account to be in a business portfolio of the Member's (Mcdomenu.de holds
  @mcdomenu.de).
- The configuration must not include ad accounts: with them, the login offers to create an ad
  account, with no way to skip it.
- Removal on a directly connected Channel is not yet proven against the real network; the first
  real Removal confirms it. If Meta refuses, the Removal fails with Meta's message and the
  Delivery stays live.
- In development mode, each account needs an Instagram Tester invite on the app.
