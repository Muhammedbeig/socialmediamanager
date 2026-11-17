import { type Capabilities, type ChannelAccess, type Connector, ConnectorError } from "../types";
import {
  type SiteChecks,
  clearChallenges,
  expectVisible,
  hasCookie,
  looksLikeChallenge,
  replaceText,
  waitEnabled,
  withChannelBrowser,
} from "./engine";

// X, through its website in the Channel's own Chrome window (no paid API).
// Written against x.com's page structure as of November 2026; text posts checked on the live site
// on 2026-11-17. If X changes a page, the Delivery fails as "page changed" with a screenshot.

const X = "https://x.com";

export const xSite: SiteChecks = {
  loginUrl: `${X}/i/flow/login`,
  loggedIn: (context) => hasCookie(context, X, "auth_token"),
  challenged: async (page) => (await looksLikeChallenge(page)) || /\/i\/flow\/(login|single_sign_on)/.test(page.url()),
};

function premium(access: Pick<ChannelAccess, "settings">): boolean {
  return access.settings.premium === true;
}

export function xCapabilities(isPremium: boolean): Capabilities {
  return {
    formats: ["text", "image", "carousel", "video"],
    // X counts a link as 23 characters and some emoji as two; this counts what is typed.
    caption: { maxChars: isPremium ? 25_000 : 280 },
    carousel: { min: 2, max: 4 },
    image: { mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"], convertTo: "image/jpeg", maxBytes: 5 * 1024 * 1024 },
    video: {
      mimeTypes: ["video/mp4", "video/quicktime"],
      maxBytes: 512 * 1024 * 1024,
      maxSeconds: isPremium ? 3 * 60 * 60 : 140,
    },
    fetchesMediaFromPublicUrl: false,
    edit: isPremium
      ? { text: true, note: "X lets Premium accounts edit a post within an hour of posting, up to 5 times." }
      : { text: false, note: "Editing on X needs Premium. Turn on the Premium setting for this Channel if it has it, or Replace the post." },
    removal: { permanent: true, note: "Removal from X is permanent." },
  };
}

function statusUrl(id: string): string {
  return `${X}/i/status/${id}`;
}

export const xConnector: Connector = {
  network: "x",
  kind: "browser",
  label: "X account",
  baseCapabilities: xCapabilities(false),
  async capabilities(access) {
    return xCapabilities(premium(access));
  },
  site: xSite,

  async publish(access, input) {
    return withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(`${X}/compose/post`, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, xSite, access.attention);
        if (!page.url().includes("/compose/post")) await page.goto(`${X}/compose/post`, { waitUntil: "domcontentloaded" });

        // x.com/compose/post opens the composer as a pop-up over the home timeline, which has a
        // composer of its own. X draws pop-ups inside #layers, so everything happens there and the
        // media and the text never end up in different composers.
        const composer = page.locator("#layers");
        const editor = await expectVisible(composer.locator('[data-testid="tweetTextarea_0"]'), "post editor");
        if (input.media.length > 0) {
          const fileInput = composer.locator('input[data-testid="fileInput"]').first();
          await fileInput.waitFor({ state: "attached", timeout: 30_000 }).catch(() => {
            throw new ConnectorError("rejected", 'The page changed at "add media", so the script needs updating.');
          });
          await fileInput.setInputFiles(input.media.map((media) => media.path));
        }
        await replaceText(page, editor, input.caption);
        if (input.media.length > 0) {
          await expectVisible(composer.locator('[data-testid="attachments"]'), "media in the composer", 120_000);
        }

        const post = composer.locator('[data-testid="tweetButton"]');
        await expectVisible(post, "Post button");
        // Media uploads must finish before X enables Post.
        await waitEnabled(post, "media upload", 15 * 60_000);
        await clearChallenges(page, context, xSite, access.attention, { goToLogin: false });
        await post.first().click();

        // From here on the post may be live.
        const link = await expectVisible(
          page.locator('[data-testid="toast"] a[href*="/status/"]'),
          "confirmation that the post was sent",
          120_000,
          true,
        );
        const href = (await link.getAttribute("href")) ?? "";
        const id = /status\/(\d+)/.exec(href)?.[1];
        if (!id) throw new ConnectorError("outcome_unknown", "X sent the post but its link could not be read.");
        return { externalPostId: id, liveUrl: new URL(href, X).toString() };
      },
      { screenshotName: access.screenshotName },
    );
  },

  async editText(access, live, text) {
    if (!premium(access)) throw new ConnectorError("rejected", xCapabilities(false).edit.note);
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(statusUrl(live.externalPostId), { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, xSite, access.attention);
        const article = await expectVisible(page.locator('article[data-testid="tweet"]'), "the post");
        await article.locator('[data-testid="caret"]').first().click();
        await (await expectVisible(page.getByRole("menuitem", { name: /edit/i }), "Edit in the post menu")).click();
        const editor = await expectVisible(page.locator('[data-testid="tweetTextarea_0"]'), "edit box");
        await replaceText(page, editor, text);
        await (await expectVisible(page.locator('[data-testid="tweetButton"]'), "Update button")).click();
        await expectVisible(page.locator('[data-testid="toast"]'), "confirmation of the edit", 60_000, true);
      },
      { screenshotName: access.screenshotName },
    );
  },

  async remove(access, live) {
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(statusUrl(live.externalPostId), { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, xSite, access.attention);
        const article = await expectVisible(page.locator('article[data-testid="tweet"]'), "the post");
        await article.locator('[data-testid="caret"]').first().click();
        await (await expectVisible(page.getByRole("menuitem", { name: /delete/i }), "Delete in the post menu")).click();
        await (await expectVisible(page.locator('[data-testid="confirmationSheetConfirm"]'), "delete confirmation")).click();
        await expectVisible(page.locator('[data-testid="toast"]'), "confirmation of the removal", 60_000);
      },
      { screenshotName: access.screenshotName },
    );
    return { permanent: true, note: xCapabilities(false).removal.note };
  },
};
