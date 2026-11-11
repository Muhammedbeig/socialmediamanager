# 3. Instagram Channels connect through Instagram Login

Date: 2026-11-11. **Superseded by [0005](0005-instagram-through-facebook-login.md)**: only Facebook
Login lets an app delete Instagram posts.

## Decision

The Instagram Connector uses "Instagram API with Instagram Login" (`graph.instagram.com`,
permissions `instagram_business_basic` and `instagram_business_content_publish`). Facebook Pages
use Facebook Login, and Threads uses its own login. Each network keeps its own app ID and secret.

## Why

- A Brand can have several Instagram Channels. Instagram Login connects each profile on its own,
  without first linking it to a Facebook Page.
- A Facebook token problem then cannot take the Instagram Channels down with it, which keeps
  Deliveries independent.
- Both login flows offer the same publishing endpoints, so nothing is lost.

Checked against Meta's content publishing docs on 2026-11-11.
