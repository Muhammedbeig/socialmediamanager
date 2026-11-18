# 9. LinkedIn company Pages post through the browser

Date: 2026-11-18.

## Decision

LinkedIn company Pages are their own network, `linkedin_page` ("LinkedIn Page"), served by a
Browser Connector. It works like TikTok, Pinterest and X: one Chrome profile per Channel, a plain
Chrome window for the login, and posting windows driven by Playwright.

- The Channel's handle is the Page's ID or vanity name (`linkedin.com/company/<handle>`), taken
  from any Page link the Member pastes.
- Publishing opens `/company/<handle>/admin/page-posts/published/?share=true`, which opens the
  share box as the Page, not as the admin.
- The post is identified by its activity URN, read from the Page's admin list of posts. Edit and
  Removal find it there and use its "..." menu.
- Personal profiles stay on the API Connector (`linkedin`), which keeps working.

## Why

- The owner wants to post to the Pages they manage. Through the API that needs the Community
  Management API, which LinkedIn grants only after a review, and only on an app that has no other
  products.
- The app is internal and serves the owner's own Pages, the same reason as the other Browser
  Connectors.

## Cost

- LinkedIn sometimes draws the Page admin inside an embedded frame and sometimes not (both seen
  2026-11-18), so the script looks for its steps in every frame of the page. A change on
  LinkedIn's side fails the Delivery as "page changed" with a screenshot.
- The admin list only draws posts near the screen, so Edit and Removal scroll until the post is
  there. Each post's "..." menu (Edit post, Delete post) sits on its admin card, outside the post.
- Video files under 75 KB are refused by LinkedIn's upload; the composer blocks them, and a
  refusal shown during upload fails the Delivery with LinkedIn's reason.
- Proven against the real network on 2026-11-18 on the eBaig Page: text, photo and video
  publish, Edit, and Removal.
- A separate network means a Page and the admin's personal profile are separate Channels, each
  with its own login: the Page's Chrome profile must be logged in as one of its admins.
- A public launch moves Pages to the Community Management API, like the other Browser Connectors.
