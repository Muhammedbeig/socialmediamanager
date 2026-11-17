import { fieldValue } from "@/domain/checks";
import { type Capabilities, type Connector, ConnectorError } from "../types";
import {
  type SiteChecks,
  anyVisible,
  clearChallenges,
  expectVisible,
  firstVisible,
  hasCookie,
  looksLikeChallenge,
  replaceText,
  waitEnabled,
  withChannelBrowser,
} from "./engine";

// TikTok, through TikTok Studio in the Channel's own Chrome window (the API keeps posts private
// until TikTok's audit). Written against TikTok Studio as of November 2026; upload and caption
// checked on the live site on 2026-11-17. A changed page fails with a screenshot.

const TIKTOK = "https://www.tiktok.com";
const STUDIO_UPLOAD = `${TIKTOK}/tiktokstudio/upload?from=webapp`;
const STUDIO_CONTENT = `${TIKTOK}/tiktokstudio/content`;

export const tiktokSite: SiteChecks = {
  loginUrl: `${TIKTOK}/login`,
  loggedIn: (context) => hasCookie(context, TIKTOK, "sessionid"),
  challenged: async (page) =>
    (await looksLikeChallenge(page)) ||
    (await anyVisible([page.locator('#captcha_container, [class*="captcha" i], [id*="captcha-verify" i]')])),
};

/**
 * TikTok Studio opens one-time questions over the upload form, such as "Turn on automatic content
 * checks?". They are answered with Cancel or Got it, which leaves the account's settings as they are.
 */
async function dismissPrompts(page: import("playwright").Page): Promise<void> {
  const prompts = [
    page.getByRole("dialog").filter({ hasText: /automatic content checks/i }).getByRole("button", { name: /^cancel$/i }),
    page.getByRole("button", { name: /^got it$/i }),
  ];
  for (const button of prompts) {
    if (await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

const PRIVACY: Record<string, RegExp> = {
  everyone: /^everyone$/i,
  friends: /^friends$/i,
  only_me: /^only (you|me)$/i,
};

export const tiktokCapabilities: Capabilities = {
  formats: ["video", "image", "carousel"],
  caption: { maxChars: 4000 },
  carousel: { min: 2, max: 35 },
  fields: [
    {
      key: "privacy",
      label: "Who can watch",
      kind: "select",
      defaultValue: "everyone",
      options: [
        { value: "everyone", label: "Everyone" },
        { value: "friends", label: "Friends" },
        { value: "only_me", label: "Only me" },
      ],
    },
  ],
  image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"], convertTo: "image/jpeg", maxBytes: 20 * 1024 * 1024 },
  video: { mimeTypes: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 4 * 1024 * 1024 * 1024, minSeconds: 3, maxSeconds: 60 * 60 },
  fetchesMediaFromPublicUrl: false,
  // The PRD's open question: TikTok caption editing is unconfirmed, so it is treated as not possible.
  edit: { text: false, note: "TikTok does not reliably let a caption be changed after posting. You can Replace the post, which loses its views and comments, or keep it as it is." },
  removal: { permanent: false, note: "TikTok keeps a removed video in Recently deleted for 30 days." },
};

export const tiktokConnector: Connector = {
  network: "tiktok",
  kind: "browser",
  label: "TikTok account",
  baseCapabilities: tiktokCapabilities,
  async capabilities() {
    return tiktokCapabilities;
  },
  site: tiktokSite,

  async publish(access, input) {
    return withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(STUDIO_UPLOAD, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, tiktokSite, access.attention);
        if (!page.url().includes("tiktokstudio/upload")) await page.goto(STUDIO_UPLOAD, { waitUntil: "domcontentloaded" });

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: "attached", timeout: 60_000 }).catch(() => {
          throw new ConnectorError("rejected", 'The page changed at "upload", so the script needs updating.');
        });
        await fileInput.setInputFiles(input.media.map((media) => media.path));

        const caption = await firstVisible(
          [page.locator(".public-DraftEditor-content"), page.locator('[contenteditable="true"][role="combobox"]'), page.locator('div[contenteditable="true"]')],
          "caption box",
          5 * 60_000,
        );
        await replaceText(page, caption, input.caption, { closeMenus: true });
        // Close any hashtag or mention suggestions the typing opened.
        await page.keyboard.press("Escape").catch(() => {});

        await dismissPrompts(page);
        const privacy = fieldValue(input.fields, tiktokCapabilities.fields![0]);
        if (privacy !== "everyone") {
          const current = await firstVisible([page.getByText(PRIVACY.everyone)], "Who can watch setting");
          await current.click();
          await (await expectVisible(page.getByText(PRIVACY[privacy]).last(), "privacy option")).click();
        }

        const post = page.locator('button[data-e2e="post_video_button"]').or(page.getByRole("button", { name: /^post$/i }));
        await expectVisible(post, "Post button", 60_000);
        // The upload must finish before TikTok enables Post.
        await waitEnabled(post, "upload to TikTok", 30 * 60_000);
        await dismissPrompts(page);
        await clearChallenges(page, context, tiktokSite, access.attention, { goToLogin: false });
        await post.first().click();

        // TikTok may ask whether to post before its content check finishes.
        const postNow = page.getByRole("button", { name: /post now/i });
        if (await postNow.first().isVisible({ timeout: 5000 }).catch(() => false)) await postNow.first().click();

        // From here on the post may be live. TikTok moves to the content list once it is accepted.
        await page
          .waitForURL(/tiktokstudio\/content/, { timeout: 180_000 })
          .catch(async () => expectVisible(page.getByText(/(video|post) (has been|is being) (uploaded|posted|published)/i), "confirmation that the post was sent", 60_000, true));

        // The newest post is first in the content list.
        await page.goto(STUDIO_CONTENT, { waitUntil: "domcontentloaded" });
        const newest = await expectVisible(page.locator('a[href*="/video/"], a[href*="/photo/"]'), "the new post in the content list", 120_000, true);
        const href = (await newest.getAttribute("href")) ?? "";
        const id = /\/(video|photo)\/(\d+)/.exec(href)?.[2];
        if (!id) throw new ConnectorError("outcome_unknown", "TikTok accepted the post but its link could not be read.");
        const handle = access.handle ? `@${access.handle.replace(/^@/, "")}` : "@";
        return { externalPostId: id, liveUrl: `${TIKTOK}/${handle}/video/${id}` };
      },
      { screenshotName: access.screenshotName },
    );
  },

  async remove(access, live) {
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(STUDIO_CONTENT, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, tiktokSite, access.attention);
        const link = await expectVisible(page.locator(`a[href*="/${live.externalPostId}"]`), "the post in the content list", 60_000);
        // The row holding the post: the nearest container with its action buttons (edit, stats,
        // comments, more). The "more" (⋯) button is the last of them and may have no name.
        const row = link.locator("xpath=ancestor::*[count(.//button) >= 4][1]");
        await row.hover().catch(() => {});
        const more = await firstVisible(
          [
            row.getByRole("button", { name: /more|actions/i }),
            row.locator('button[aria-haspopup], [data-tt*="more" i]'),
            row.locator("button").last(),
          ],
          "the post's actions menu",
        );
        await more.click();
        await (await expectVisible(page.getByText(/^delete$/i), "Delete in the actions menu")).click();
        await (await expectVisible(page.getByRole("button", { name: /^delete$/i }).last(), "delete confirmation")).click();
        await link.waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
      },
      { screenshotName: access.screenshotName },
    );
    return { permanent: false, note: tiktokCapabilities.removal.note };
  },
};
