# 5. Instagram Channels connect through Facebook Login

Date: 2026-11-11. Supersedes [0003](0003-instagram-login-per-channel.md).

## Decision

The Instagram Connector uses "Instagram API with Facebook Login" on `graph.facebook.com`, with the
permissions `instagram_basic`, `instagram_content_publish` and `instagram_manage_contents`. Each
Instagram professional profile linked to a granted Facebook Page becomes one Channel and publishes
with that Page's token. Instagram shares the Facebook app ID and secret.

## Why

- Meta's Instagram Media reference (checked 2026-11-11) says deleting media "only supports
  Instagram API with Facebook login". With Instagram Login, Removal and Replace would be
  impossible on Instagram, and v1 needs both.
- Page tokens made from a long-lived user token do not expire, so Instagram Channels need no
  token refresh.

## Cost

- Every Instagram profile must be linked to a Facebook Page the owner manages.
- One Facebook login can still connect several Instagram Channels, one per linked Page.
