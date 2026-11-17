# Setup

What the owner sets up once on the Windows 11 laptop. Run commands in PowerShell from the project folder.

The app's **Settings** screen shows which of these steps are done, what is still missing, and
has a button to test Cloudflare R2 end to end. After changing `.env.local`, restart the app.

Secrets go only in `.env.local` (never committed, never pasted into chat). Start it from the template:

```powershell
Copy-Item .env.example .env.local
```

## 1. Node.js and FFmpeg

Already installed on this laptop (Node 24, FFmpeg 8). To check:

```powershell
node -v
ffmpeg -version
```

## 2. PostgreSQL

1. Install it and approve the admin prompt. winget normally installs without asking questions and
   sets the `postgres` user's password to `postgres` (the installer's default). If it does ask,
   choose your own password. The database only accepts connections from this laptop.

   ```powershell
   winget install PostgreSQL.PostgreSQL.17
   ```

   It installs as a Windows service that starts with the laptop.

2. Create the app database and the test database. Each command asks for the `postgres` password.

   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres social_publisher
   & "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres social_publisher_test
   ```

3. In `.env.local`, replace `YOUR_PASSWORD` in `DATABASE_URL` and `TEST_DATABASE_URL`.

4. Create the tables and the owner Member:

   ```powershell
   npm run db:setup
   ```

## 3. Meta developer app (Facebook Pages, Instagram, Threads)

One app in development mode covers all three networks. In development mode it works only for
people with a role on the app, which is all an internal tool needs. No app review.

In the redirect URLs below, `APP_URL` is the value in your `.env.local`, normally
`https://localhost:3000`.

1. Go to <https://developers.facebook.com/apps>, log in with the Facebook account that manages
   your Pages, and create an app. Add these use cases:
   - **Manage everything on your Page** (Facebook Pages)
   - **Manage messaging & content on Instagram**, choosing **API setup with Facebook login**
   - **Access the Threads API**
2. Leave the app in **Development** mode. While it is, Facebook accepts `http://localhost`
   redirect addresses.

### Facebook Pages

1. In the Pages use case, add the permissions `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts` and `pages_manage_engagement`.
2. Under **Facebook Login for Business > Settings > Valid OAuth Redirect URIs**, add both:
   `APP_URL/api/channels/callback/facebook` and `APP_URL/api/channels/callback/instagram`
3. From **App settings > Basic**, copy the App ID and App secret into `FACEBOOK_APP_ID` and
   `FACEBOOK_APP_SECRET`.

### Instagram

Instagram connects through Facebook Login, because only that login lets an app remove Instagram
posts (decision record 0005). Each Instagram profile must be:

- a Business or Creator account (Instagram app: Settings > Account type and tools > Switch to
  professional account), and
- linked to one of your Facebook Pages (the Page's settings > Linked accounts > Instagram).

In the Instagram use case (API setup with Facebook login), add the permissions `instagram_basic`,
`instagram_content_publish` and `instagram_manage_contents`. Nothing else: it uses the Facebook
app ID and secret, and your role on the app is enough, so no tester invites are needed.

When you click **Connect Instagram through Facebook**, Facebook asks which Pages to share. Every
shared Page with a linked Instagram profile becomes one Instagram Channel.

#### Instagram directly (optional, no Facebook Page)

A professional Instagram account that is not linked to a Page can connect with Meta's **Unified
login** instead (decision record 0008; Meta's older "Instagram login" is not offered to new apps).
Posting, Replace and Removal work the same as through Facebook. The account must belong to one of
your business portfolios (Meta Business Suite > Settings > Accounts > Instagram accounts > Add).

1. Unified login needs the Meta app to be owned by a business portfolio. In the Instagram use
   case, open **API setup with Unified login** and connect a portfolio.
2. There, **Create new configuration** from the template, then edit it under **Facebook Login for
   Business > Configurations**: assets **Instagram accounts** only (untick Ad accounts, or the login
   offers to create an ad account), and permissions `instagram_basic`, `instagram_content_publish`,
   `instagram_manage_contents` (for Removal), `instagram_manage_comments` and
   `instagram_manage_messages`, with no ads permissions. Keep the system-user token that never
   expires. Copy the **Configuration ID** into `INSTAGRAM_LOGIN_CONFIG_ID`. It is not a secret; the
   login uses the Facebook app ID and secret.
3. Under **Facebook Login for Business > Settings > Valid OAuth Redirect URIs**, add
   `APP_URL/api/channels/callback/instagram-login`.
4. Under **App roles > Roles > Add People > Instagram Tester**, add the account, then accept the
   invite in Instagram on the web: Settings > Website permissions > Apps and websites > Tester invites.

Then use **Connect Instagram directly**: pick the business portfolio and the Instagram accounts
to share. Each becomes a Channel; the login does not expire. An account connected one way and
later the other stays one Channel and switches over.

### Threads

1. In the Threads use case, add the permissions `threads_basic`, `threads_content_publish` and
   `threads_delete`.
2. In the Threads use case settings, add the redirect callback URL:
   `APP_URL/api/channels/callback/threads`
   If Threads refuses an `http://` address, see step 5.
3. Copy the **Threads app ID** and **Threads app secret** into `THREADS_APP_ID` and
   `THREADS_APP_SECRET`. They differ from the Facebook ones.
4. Add each Threads profile under **App roles > Roles > Add People > Threads Tester**. Then accept
   the invite as that profile: Threads > Settings > Account > Website permissions > Invites.

## 3b. LinkedIn

1. Go to <https://www.linkedin.com/developers/apps> and **Create app**. LinkedIn asks for a
   company Page to link the app to (any Page you manage; it is only shown on the consent screen).
2. On the **Products** tab, request **Share on LinkedIn** and **Sign In with LinkedIn using
   OpenID Connect**. Both are granted at once.
3. On the **Auth** tab, add the redirect URL `APP_URL/api/channels/callback/linkedin`, then copy
   the **Client ID** and **Primary Client Secret** into `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

This posts as your personal profile. Posting as a **company Page** needs the **Community
Management API** product, which LinkedIn grants after a review and only on an app with no other
products: create a second app for it, use its keys instead, and set `LINKEDIN_PAGES=1`.

Logins last 60 days; the Channels screen shows the date, and you reconnect when it runs out.

## 3c. YouTube (Google)

1. Create a Google Cloud project: <https://console.cloud.google.com/projectcreate>.
2. Turn on the **YouTube Data API v3** for it:
   <https://console.cloud.google.com/apis/library/youtube.googleapis.com>.
3. Open **Google Auth Platform** (<https://console.cloud.google.com/auth/overview>) and set it up:
   app name, your email, audience **External**. Add your own Google account as a **test user**.
4. Under **Clients**, create an OAuth client of type **Web application**, with the authorized
   redirect URI `APP_URL/api/channels/callback/youtube`. Copy its Client ID and Client secret
   into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Google ends logins after 7 days while the app is in **Testing**. To keep YouTube connected,
   under **Audience** click **Publish app**. You do not need Google's verification for your own
   use: when you connect, Google warns that the app is unverified; choose **Advanced**, then go on.

YouTube allows about 100 uploads a day per project.

## 3d. TikTok, Pinterest and X

No keys. On the Channels screen, use **Add a TikTok, Pinterest or X account**. A Chrome window
of its own opens at the network's login page: log in there once (the publisher must be running).
That window's profile keeps the login for later Posts, separate from your own Chrome.

When a network asks for a code or a CAPTCHA while posting, you get a desktop notification and the
Post waits on the **Needs attention** screen until you clear it in that window.

For an X account with Premium, tick **Premium** on its row: it allows long posts and editing.

## 4. Cloudflare R2

Instagram and Threads fetch media from a public URL. The app uploads the file to R2 when a
Delivery starts and deletes it once the Delivery is live.

1. In the Cloudflare dashboard, open **R2 Object Storage** and turn it on. Cloudflare may ask for
   a card even for the free tier.
2. Create a bucket named `social-publisher-media`.
3. In the bucket's **Settings > Public Development URL**, enable it. Copy the
   `https://pub-....r2.dev` address into `R2_PUBLIC_BASE_URL`.
4. In the bucket's **Settings > Object lifecycle rules**, add a rule that deletes objects after
   1 day. This is a safety net if the app is closed before it cleans up.
5. Under **R2 > Manage API tokens**, create a token with **Object Read & Write** on this bucket
   only. Copy the Access Key ID and Secret Access Key into `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY`.
6. Copy your Account ID (shown on the R2 overview page) into `R2_ACCOUNT_ID`.

## 5. HTTPS on localhost (only if a network refuses http)

Facebook accepts `http://localhost` redirects for apps in development mode. If Threads refuses
one, switch to HTTPS:

1. Set `APP_URL=https://localhost:3000` in `.env.local`, and use `https://` in the redirect URLs above.
2. Run `npm run dev` once. Next.js downloads the `mkcert` tool, creates a certificate for
   localhost in the `certificates` folder, and Windows asks once whether to trust it. Choose Yes.
3. The background service (step 7) then serves HTTPS with the same certificate.

## 6. Token encryption key

Nothing to do. On first run the app creates a key and stores it in Windows Credential Manager;
network tokens in the database are encrypted with it.

## 7. Run it as a background service that starts at login

`npm run dev` is for working on the code. For everyday use, run the production build as a service:

```powershell
npm run build              # after every code change
npm run service:install    # start at every Windows login (adds a shortcut to your Startup folder)
npm run service:start      # start it now, hidden
```

- The app is then at `APP_URL` (normally <https://localhost:3000>); only this laptop can reach it.
- The log is `data\logs\service.log`.
- Only one copy runs: if port 3000 is taken (for example by `npm run dev`), the service does not start.
- Start at login can also be turned on and off on the Settings screen.
- To stop it starting at login: `npm run service:uninstall`. To stop a running copy, end the
  `node.exe` process that runs `service\main.ts` in Task Manager, or restart Windows.
- Desktop notifications use Windows' own notification system. If Focus Assist / Do Not Disturb is
  on, they wait in the notification centre. The Alerts badge in the app shows them either way.
