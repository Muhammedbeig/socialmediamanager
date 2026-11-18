import type { Frame, Locator, Page } from "playwright";
import { type Capabilities, type ChannelAccess, type Connector, ConnectorError } from "../types";
import {
  PageChanged,
  type SiteChecks,
  clearChallenges,
  expectVisible,
  firstVisible,
  hasCookie,
  looksLikeChallenge,
  replaceText,
  waitEnabled,
  withChannelBrowser,
} from "./engine";

// LinkedIn company Pages, through the Page's admin screen in the Channel's own Chrome window.
// The official route (the Community Management API) needs LinkedIn's approval; see docs/adr/0009.
// Written against linkedin.com's Page admin as seen on 2026-11-18: the admin screen is drawn inside
// an embedded frame, and the post box is LinkedIn's usual share box (Quill editor, "Add media",
// "Post"). If LinkedIn changes a page, the Delivery fails as "page changed" with a screenshot.

const LINKEDIN = "https://www.linkedin.com";

export const linkedinPageSite: SiteChecks = {
  loginUrl: `${LINKEDIN}/login`,
  loggedIn: (context) => hasCookie(context, LINKEDIN, "li_at"),
  challenged: looksLikeChallenge,
};

export const linkedinPageCapabilities: Capabilities = {
  formats: ["text", "image", "carousel", "video"],
  caption: { maxChars: 3000 },
  carousel: { min: 2, max: 20 },
  image: { mimeTypes: ["image/jpeg", "image/png", "image/gif"], convertTo: "image/jpeg", maxBytes: 8 * 1024 * 1024 },
  // The upload refuses files under 75 KB ("Please choose a file which is larger than 75 Kb", seen 2026-11-18).
  video: {
    mimeTypes: ["video/mp4", "video/quicktime"],
    maxBytes: 5 * 1024 * 1024 * 1024,
    minBytes: 75 * 1024,
    minSeconds: 3,
    maxSeconds: 15 * 60,
  },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "LinkedIn lets a Page admin edit the text of a Page post." },
  removal: { permanent: true, note: "Removal from LinkedIn is permanent." },
};

/** The Page's ID or vanity name, as in linkedin.com/company/<this>. */
function pageOf(access: Pick<ChannelAccess, "handle">): string {
  if (!access.handle) throw new ConnectorError("rejected", "This Channel has no LinkedIn Page link. Remove it and add it again with the Page's link.");
  return encodeURIComponent(access.handle);
}

const postsUrl = (access: Pick<ChannelAccess, "handle">) => `${LINKEDIN}/company/${pageOf(access)}/admin/page-posts/published/`;

/** The frame that shows `selector`: LinkedIn draws the Page admin inside an embedded frame. */
async function frameShowing(page: Page, selector: string, step: string, timeoutMs = 60_000): Promise<Frame> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const frame of page.frames()) {
      if (await frame.locator(selector).first().isVisible().catch(() => false)) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new PageChanged(step);
}

/**
 * One post's card in the Page's admin list of published posts, by its URN. LinkedIn only draws
 * the posts near the screen, so the list is scrolled until the post is there.
 */
async function postInList(page: Page, access: ChannelAccess, urn: string): Promise<{ frame: Frame; card: Locator }> {
  await page.goto(postsUrl(access), { waitUntil: "domcontentloaded" });
  const frame = await frameShowing(page, '[data-urn^="urn:li:activity:"]', "the Page's post list");
  const post = frame.locator(`[data-urn="${urn}"]`).first();
  for (let step = 0; step < 40 && (await post.count()) === 0; step++) {
    await frame.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await page.waitForTimeout(700);
  }
  if ((await post.count()) === 0) {
    throw new ConnectorError("rejected", "The post is not in the Page's post list, so it may have been deleted on LinkedIn.", {
      notFound: true,
    });
  }
  await post.scrollIntoViewIfNeeded().catch(() => {});
  // The admin card around the post holds the Page's own "..." menu (Edit post, Delete post).
  const card = post.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " artdeco-card ")][1]');
  return { frame, card };
}

/** Opens a post's "..." menu on its admin card and picks an item, such as "Delete post". */
async function chooseFromPostMenu(card: Locator, item: RegExp, step: string) {
  const menu = await firstVisible(
    [card.locator("#org-update-actions-dropdown-trigger"), card.locator("button.feed-shared-control-menu__trigger")],
    "the post's ... menu",
  );
  await menu.click();
  const choice = await firstVisible(
    [card.locator(".artdeco-dropdown__item").filter({ hasText: item }), card.getByRole("menuitem", { name: item })],
    step,
  );
  await choice.click();
}

const editorIn = (frame: Frame) => frame.locator(".share-box-v2__modal .ql-editor, [role=dialog] .ql-editor");

export const linkedinPageConnector: Connector = {
  network: "linkedin_page",
  kind: "browser",
  label: "LinkedIn company Page",
  baseCapabilities: linkedinPageCapabilities,
  async capabilities() {
    return linkedinPageCapabilities;
  },
  site: linkedinPageSite,

  async publish(access, input) {
    return withChannelBrowser(
      access.channelId,
      async (page, context) => {
        // "?share=true" opens the Page's post box; it posts as the Page, not as the admin.
        await page.goto(`${postsUrl(access)}?share=true`, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, linkedinPageSite, access.attention);
        if (!page.url().includes("/admin/")) await page.goto(`${postsUrl(access)}?share=true`, { waitUntil: "domcontentloaded" });

        const frame = await frameShowing(page, ".share-box-v2__modal .ql-editor", "the Page's post box");
        const box = frame.locator(".share-box-v2__modal");

        if (input.media.length > 0) {
          await (await expectVisible(box.locator('button[aria-label="Add media"]'), "Add media")).click();
          const fileInput = frame.locator("#media-editor-file-selector__file-input");
          await fileInput.waitFor({ state: "attached", timeout: 30_000 }).catch(() => {
            throw new PageChanged("upload");
          });
          await fileInput.setInputFiles(input.media.map((media) => media.path));
          // Next turns on once LinkedIn has taken the files, then leads back to the post box.
          // LinkedIn may refuse a file instead ("Something went wrong" with its reason).
          const next = frame.locator('.artdeco-modal button[aria-label="Next"]');
          await expectVisible(next, "Next after the upload", 60_000);
          await nextOrRefusal(frame, next);
          await next.first().click();
        }

        const editor = await expectVisible(editorIn(frame), "post editor");
        await replaceText(page, editor, input.caption);

        const post = frame.locator(".share-box-v2__modal .share-actions__primary-action");
        await expectVisible(post, "Post button");
        await waitEnabled(post, "media processing", 15 * 60_000);
        await clearChallenges(page, context, linkedinPageSite, access.attention, { goToLogin: false });
        await post.first().click();

        // From here on the post may be live. LinkedIn confirms with a toast linking to the post.
        await frame
          .locator(".share-box-v2__modal")
          .waitFor({ state: "hidden", timeout: 15 * 60_000 })
          .catch(() => {
            throw new PageChanged("the post box closing after Post", true);
          });
        const toastLink = await firstVisible(
          page.frames().map((f) => f.locator('.artdeco-toast-item a[href*="/feed/update/"], [role=alert] a[href*="/feed/update/"]')),
          "confirmation that the post went out",
          60_000,
        ).catch(() => null);
        let urn = toastLink ? /urn:li:[a-zA-Z]+:\d+/.exec(decodeURIComponent((await toastLink.getAttribute("href")) ?? ""))?.[0] : undefined;

        // The admin list names posts by their activity URN, which is what Edit and Remove look for.
        const listed = await findNewPost(page, access, input.caption).catch(() => null);
        if (listed) urn = listed;
        if (!urn) throw new ConnectorError("outcome_unknown", "LinkedIn took the post, but it could not be found in the Page's post list.");
        return { externalPostId: urn, liveUrl: `${LINKEDIN}/feed/update/${urn}/` };
      },
      { screenshotName: access.screenshotName },
    );
  },

  async editText(access, live, text) {
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(postsUrl(access), { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, linkedinPageSite, access.attention);
        const { frame, card } = await postInList(page, access, live.externalPostId);
        await chooseFromPostMenu(card, /^\s*edit post\s*$/i, "Edit post in the post's menu");
        const editor = await expectVisible(editorIn(frame), "edit box");
        await replaceText(page, editor, text);
        const save = await firstVisible(
          [frame.locator(".share-box-v2__modal .share-actions__primary-action"), frame.getByRole("button", { name: /^save$/i })],
          "Save in the edit box",
        );
        await waitEnabled(save, "Save in the edit box", 30_000);
        await save.click();
        await frame.locator(".share-box-v2__modal").waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {
          throw new PageChanged("the edit box closing after Save", true);
        });
      },
      { screenshotName: access.screenshotName },
    );
  },

  async remove(access, live) {
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(postsUrl(access), { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, linkedinPageSite, access.attention);
        const { frame, card } = await postInList(page, access, live.externalPostId);
        await chooseFromPostMenu(card, /^\s*delete post\s*$/i, "Delete post in the post's menu");
        const confirm = await firstVisible(
          [
            frame.locator(".artdeco-modal button.artdeco-button--primary").filter({ hasText: /^\s*delete\s*$/i }),
            frame.getByRole("button", { name: /^delete$/i }),
          ],
          "delete confirmation",
        );
        await confirm.click();
        await card.waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
      },
      { screenshotName: access.screenshotName },
    );
    return { permanent: true, note: linkedinPageCapabilities.removal.note };
  },
};

/**
 * Waits until Next can be pressed after an upload. If LinkedIn shows "Something went wrong"
 * instead, the Delivery fails with LinkedIn's own reason; nothing was posted.
 */
async function nextOrRefusal(frame: Frame, next: Locator) {
  const refusal = frame.locator(".artdeco-modal").filter({ hasText: /something went wrong/i });
  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    if (await refusal.first().isVisible().catch(() => false)) {
      const text = (await refusal.first().innerText().catch(() => "")).replace(/\s+/g, " ");
      const reason = /something went wrong\s*(.*?)\s*(try again|back|next|$)/i.exec(text)?.[1]?.trim();
      throw new ConnectorError("rejected", `LinkedIn refused the file${reason ? `: ${reason}` : "."}`);
    }
    const enabled = (await next.first().isEnabled().catch(() => false)) && (await next.first().getAttribute("aria-disabled").catch(() => null)) !== "true";
    if (enabled) return;
    await frame.page().waitForTimeout(1000);
  }
  throw new PageChanged("media upload");
}

/** The URN of the newest post in the Page's list whose text starts like `caption`. */
async function findNewPost(page: Page, access: ChannelAccess, caption: string): Promise<string | undefined> {
  const opening = caption.trim().split("\n")[0].slice(0, 40);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(postsUrl(access), { waitUntil: "domcontentloaded" });
    const selector = '[data-urn^="urn:li:activity:"]';
    const frame = await frameShowing(page, selector, "the Page's post list", 30_000).catch(() => null);
    if (frame) {
      const posts = frame.locator(selector);
      const candidate = opening ? posts.filter({ hasText: opening }).first() : posts.first();
      if (await candidate.isVisible().catch(() => false)) return (await candidate.getAttribute("data-urn")) ?? undefined;
    }
    await page.waitForTimeout(10_000);
  }
  return undefined;
}
