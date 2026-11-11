# Setup

What the owner sets up once on the Windows 11 laptop. Run commands in PowerShell from the project folder.

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

1. Go to <https://developers.facebook.com/apps>, log in with the Facebook account that manages
   your Pages, and create an app. Add these use cases:
   - **Manage everything on your Page** (Facebook Pages)
   - **Manage messaging & content on Instagram** (Instagram API with Instagram Login)
   - **Access the Threads API**
2. Leave the app in **Development** mode.

### Facebook Pages

1. In the Pages use case, add the permissions `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts` and `pages_manage_engagement`.
2. Under **Facebook Login for Business > Settings**, add this Valid OAuth Redirect URI:
   `https://localhost:3000/api/channels/callback/facebook`
3. From **App settings > Basic**, copy the App ID and App secret into `FACEBOOK_APP_ID` and
   `FACEBOOK_APP_SECRET`.

### Instagram

Each Instagram profile must be a Business or Creator account (Instagram app: Settings >
Account type and tools > Switch to professional account).

1. In the Instagram use case, add the permissions `instagram_business_basic` and
   `instagram_business_content_publish`.
2. Under **API setup with Instagram login > Business login settings**, add the OAuth redirect URI:
   `https://localhost:3000/api/channels/callback/instagram`
3. Copy the **Instagram app ID** and **Instagram app secret** from that page into
   `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`. They differ from the Facebook ones.
4. Add each Instagram profile under **App roles > Roles > Add People > Instagram Tester**. Then
   accept the invite as that profile: Instagram > Settings > Apps and websites > Tester invites.

### Threads

1. In the Threads use case, add the permissions `threads_basic`, `threads_content_publish` and
   `threads_delete`.
2. In the Threads use case settings, add the redirect callback URL:
   `https://localhost:3000/api/channels/callback/threads`
3. Copy the **Threads app ID** and **Threads app secret** into `THREADS_APP_ID` and
   `THREADS_APP_SECRET`. They differ from the Facebook ones.
4. Add each Threads profile under **App roles > Roles > Add People > Threads Tester**. Then accept
   the invite as that profile: Threads > Settings > Account > Website permissions > Invites.

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

## 5. HTTPS on localhost

Meta only redirects to HTTPS addresses, so `.env.example` sets `APP_URL=https://localhost:3000`.
With that in `.env.local`, `npm run dev` serves HTTPS. The first time, Next.js downloads the
`mkcert` tool, creates a certificate for localhost, and Windows asks once whether to trust it.
Choose Yes. Without it, the browser shows a warning on every visit.

## 6. Token encryption key

Nothing to do. On first run the app creates a key and stores it in Windows Credential Manager;
network tokens in the database are encrypted with it.
