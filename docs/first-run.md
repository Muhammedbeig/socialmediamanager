# First run with your real Channels

Once the keys are in `.env.local` (see [setup.md](setup.md)), this is the order to check
everything works, from the least to the most public.

1. **Restart the app** (`npm run dev`, or the service) so it reads the new keys.
2. **Settings**: every required item should say Ready. Click **Test R2**: it uploads a tiny file,
   fetches it from its public address, and deletes it.
3. **Brands**: create your Brands.
4. **Channels**: choose a Brand, then **Connect Facebook**, **Connect Instagram**, **Connect
   Threads**. Each sends you to the network's own login and back. Facebook and Instagram list the
   Pages you choose to share; each Page (and each Instagram profile linked to one) becomes a Channel.
5. **First Post to one Channel**: compose a photo Post, pick a single Channel, and schedule it a
   few minutes ahead. Watch it on the Post screen: Scheduled, then Publishing, then a tick and a
   **View live post** link.
6. **Edit or Replace, then Remove** that test Post from its Post screen, and check on the network
   that it changed and then disappeared.
7. Repeat 5 and 6 for each network, then try one Post to all of them.

If a Delivery fails, its row says why, an alert appears, and **Retry** sends it again. Messages
from the network are shown as they are, so they usually say what to fix (a missing permission,
a file it refused, an expired login).

Facebook and Instagram run in development mode, so posts are made by you, as you, to your own Pages
and profiles. Nobody else can use the app's login.
