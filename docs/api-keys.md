# API keys: where to get each one

Everything the app needs from outside, with the link to start from. Put every value in `.env.local`
(never in chat, never committed), restart the app, then check **Settings**: each item turns Ready.
The click-by-click steps are in [setup.md](setup.md).

In every redirect URL below, `APP_URL` means the value in `.env.local`, normally
`https://localhost:3000`.

| For | What to get | Where | Put in `.env.local` |
| --- | --- | --- | --- |
| Facebook Pages and Instagram | App ID and App secret of a Meta app (development mode) | <https://developers.facebook.com/apps> | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| Threads | Threads app ID and Threads app secret (same Meta app, Threads use case) | <https://developers.facebook.com/apps> | `THREADS_APP_ID`, `THREADS_APP_SECRET` |
| Instagram and Threads media | Cloudflare R2 bucket, its public URL, and an R2 API token | <https://dash.cloudflare.com> → R2 Object Storage | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` |
| LinkedIn | Client ID and Primary Client Secret of a LinkedIn app | <https://www.linkedin.com/developers/apps> | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (and `LINKEDIN_PAGES=1` for company Pages) |
| YouTube | OAuth client (Web application) of a Google Cloud project with the YouTube Data API v3 on | <https://console.cloud.google.com/apis/credentials> | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| TikTok, Pinterest, X | Nothing: each account logs in once in its own Chrome window | Channels screen → Add a TikTok, Pinterest or X account | — |

## Redirect URLs to register

| Where | URL |
| --- | --- |
| Meta app → Facebook Login for Business → Valid OAuth Redirect URIs | `APP_URL/api/channels/callback/facebook` and `APP_URL/api/channels/callback/instagram` |
| Meta app → Threads use case → redirect callback URLs | `APP_URL/api/channels/callback/threads` |
| LinkedIn app → Auth → Authorized redirect URLs | `APP_URL/api/channels/callback/linkedin` |
| Google OAuth client → Authorized redirect URIs | `APP_URL/api/channels/callback/youtube` |

## Permissions to add

| App | Permissions or products |
| --- | --- |
| Meta: Pages use case | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement` |
| Meta: Instagram use case (API setup with Facebook login) | `instagram_basic`, `instagram_content_publish`, `instagram_manage_contents` |
| Meta: Threads use case | `threads_basic`, `threads_content_publish`, `threads_delete`, and your profile as a Threads Tester |
| LinkedIn | Products **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** (company Pages: **Community Management API** on a separate app) |
| Google | **YouTube Data API v3** enabled; OAuth consent with you as a test user, then **Publish app** so logins do not end after 7 days |

## Before you start, check

- Each Instagram profile is a Business or Creator account and is linked to one of your Facebook Pages.
- You are an admin of the Facebook Pages and the LinkedIn Page you want to post to.
- Google Chrome is installed (Settings shows it), for TikTok, Pinterest and X.

## Then

Follow [first-run.md](first-run.md): connect one Channel per network, send one test Post to it,
Edit or Replace it, Remove it, and only then post to everything.
