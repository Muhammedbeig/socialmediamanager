import type { Page } from "playwright";
import { fieldValue } from "@/domain/checks";
import { type Capabilities, type Connector, ConnectorError } from "../types";
import {
  type SiteChecks,
  clearChallenges,
  expectVisible,
  firstVisible,
  hasCookie,
  looksLikeChallenge,
  replaceText,
  withChannelBrowser,
} from "./engine";

// Pinterest, through its website in the Channel's own Chrome window (the API keeps Pins private
// until Standard access is granted). Written against pinterest.com's Pin builder as known in
// November 2026 and not yet run against the live site: a changed page fails with a screenshot.

const PINTEREST = "https://www.pinterest.com";

export const pinterestSite: SiteChecks = {
  loginUrl: `${PINTEREST}/login/`,
  loggedIn: (context) => hasCookie(context, PINTEREST, "_auth"),
  challenged: looksLikeChallenge,
};

export const pinterestCapabilities: Capabilities = {
  formats: ["image", "video"],
  // The caption becomes the Pin's description.
  caption: { maxChars: 500 },
  fields: [
    { key: "board", label: "Board", kind: "text", required: true, maxLength: 180, help: "Exactly as the board is named on Pinterest." },
    { key: "title", label: "Pin title", kind: "text", maxLength: 100 },
    { key: "link", label: "Link", kind: "text", maxLength: 2048, help: "Where the Pin leads when clicked (optional)." },
  ],
  image: { mimeTypes: ["image/jpeg", "image/png"], convertTo: "image/jpeg", maxBytes: 20 * 1024 * 1024 },
  video: { mimeTypes: ["video/mp4", "video/quicktime"], maxBytes: 2 * 1024 * 1024 * 1024, minSeconds: 4, maxSeconds: 15 * 60 },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "Pinterest lets the description of a Pin be edited; its image or video cannot change." },
  removal: { permanent: true, note: "Removal from Pinterest is permanent." },
};

function field(values: Record<string, unknown>, key: string): string {
  return fieldValue(values, pinterestCapabilities.fields!.find((spec) => spec.key === key)!).trim();
}

const descriptionCandidates = (page: Page) => [
  page.locator('#storyboard-selector-description [contenteditable="true"]'),
  page.locator('div[contenteditable="true"][aria-label*="description" i]'),
  page.locator('[data-test-id*="description" i] [contenteditable="true"]'),
  page.getByRole("textbox", { name: /description/i }),
];

/** Opens the Pin's "Edit Pin" dialog. */
async function openEdit(page: Page, pinId: string) {
  await page.goto(`${PINTEREST}/pin/${pinId}/`, { waitUntil: "domcontentloaded" });
  const more = await firstVisible(
    [page.getByRole("button", { name: /more options|more actions/i }), page.locator('[data-test-id="closeup-action-items"] button[aria-label*="more" i]')],
    "the Pin's More options button",
  );
  await more.click();
  await (await expectVisible(page.getByText(/^edit pin$/i), "Edit Pin in the menu")).click();
}

export const pinterestConnector: Connector = {
  network: "pinterest",
  kind: "browser",
  label: "Pinterest account",
  baseCapabilities: pinterestCapabilities,
  async capabilities() {
    return pinterestCapabilities;
  },
  site: pinterestSite,

  async publish(access, input) {
    return withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(`${PINTEREST}/pin-creation-tool/`, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, pinterestSite, access.attention);
        if (!page.url().includes("pin-creation-tool")) await page.goto(`${PINTEREST}/pin-creation-tool/`, { waitUntil: "domcontentloaded" });

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: "attached", timeout: 30_000 }).catch(() => {
          throw new ConnectorError("rejected", 'The page changed at "upload", so the script needs updating.');
        });
        await fileInput.setInputFiles(input.media[0].path);

        const title = field(input.fields, "title");
        if (title) {
          const titleBox = await firstVisible(
            [page.locator("#storyboard-selector-title"), page.getByPlaceholder(/add a title/i), page.getByRole("textbox", { name: /title/i })],
            "Pin title field",
            120_000,
          );
          await titleBox.fill(title);
        }
        if (input.caption) {
          const description = await firstVisible(descriptionCandidates(page), "Pin description field", 120_000);
          await replaceText(page, description, input.caption);
        }
        const link = field(input.fields, "link");
        if (link) {
          const linkBox = await firstVisible([page.locator("#WebsiteField"), page.getByPlaceholder(/add a link/i)], "Pin link field");
          await linkBox.fill(link);
        }

        const board = field(input.fields, "board");
        const boardButton = await firstVisible(
          [page.locator('[data-test-id="board-dropdown-select-button"]'), page.getByRole("button", { name: /choose a board|select/i })],
          "board picker",
        );
        await boardButton.click();
        const search = await firstVisible([page.getByPlaceholder(/search/i), page.locator('input[id*="search" i]')], "board search");
        await search.fill(board);
        const option = page.locator('[data-test-id="board-row"], [role="option"], [role="button"]').filter({ hasText: board });
        await (await expectVisible(option, `the board "${board}"`, 15_000)).click();

        const publish = await expectVisible(page.getByRole("button", { name: /^publish$/i }), "Publish button", 15 * 60_000);
        await clearChallenges(page, context, pinterestSite, access.attention, { goToLogin: false });
        await publish.click();

        // From here on the Pin may be live.
        const seen = await expectVisible(page.locator('a[href*="/pin/"]').filter({ hasText: /see (your )?pin|view/i }), "confirmation that the Pin was published", 180_000, true);
        const href = (await seen.getAttribute("href")) ?? "";
        const id = /\/pin\/(\d+)/.exec(href)?.[1];
        if (!id) throw new ConnectorError("outcome_unknown", "Pinterest published the Pin but its link could not be read.");
        return { externalPostId: id, liveUrl: `${PINTEREST}/pin/${id}/` };
      },
      { screenshotName: access.screenshotName },
    );
  },

  async editText(access, live, text) {
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(`${PINTEREST}/pin/${live.externalPostId}/`, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, pinterestSite, access.attention);
        await openEdit(page, live.externalPostId);
        const description = await firstVisible(descriptionCandidates(page), "description in Edit Pin");
        await replaceText(page, description, text);
        await (await expectVisible(page.getByRole("button", { name: /^save$/i }), "Save button")).click();
        await page.getByRole("button", { name: /^save$/i }).first().waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
      },
      { screenshotName: access.screenshotName },
    );
  },

  async remove(access, live) {
    await withChannelBrowser(
      access.channelId,
      async (page, context) => {
        await page.goto(`${PINTEREST}/pin/${live.externalPostId}/`, { waitUntil: "domcontentloaded" });
        await clearChallenges(page, context, pinterestSite, access.attention);
        await openEdit(page, live.externalPostId);
        await (await expectVisible(page.getByRole("button", { name: /^delete$/i }), "Delete in Edit Pin")).click();
        await (await expectVisible(page.getByRole("button", { name: /^delete( pin)?$/i }).last(), "delete confirmation")).click();
        await page.waitForURL((url) => !url.pathname.includes(`/pin/${live.externalPostId}`), { timeout: 30_000 }).catch(() => {});
      },
      { screenshotName: access.screenshotName },
    );
    return { permanent: true, note: pinterestCapabilities.removal.note };
  },
};
