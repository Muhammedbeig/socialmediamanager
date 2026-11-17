import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import type { BrowserContext, Locator, Page } from "playwright";
import { requireEnv } from "@/env";
import { dataPath } from "@/media/ffmpeg";
import { type AttentionHooks, ConnectorError } from "../types";

// The browser engine behind the TikTok, Pinterest and X Connectors (AGENTS.md guardrails):
// - always a visible window of the installed Google Chrome (docs/adr/0004), never headless;
// - one saved profile per Channel, separate from the owner's own Chrome profile;
// - one task at a time per Channel, across processes (a database lock);
// - no stealth, no fingerprint tricks, no CAPTCHA solving: login checks go to the Member;
// - every step checks the page, and a mismatch fails as "page changed" with a screenshot.
// Logins are the exception to automation: the Member logs in in a plain Chrome window on the
// Channel's profile that the app starts but does not control (openPlainChrome). Sites such as
// Google refuse to sign in inside a browser under automation; a plain window is an ordinary
// browser, so no detection is being evaded. Posting windows reuse the saved session.

export function profileDir(channelId: string): string {
  return dataPath(path.join("browser-profiles", channelId));
}

/** Where Windows installs Google Chrome, for all users or just this one; null if not found. */
export function chromePath(): string | null {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
}

/**
 * Opens a plain Chrome window (not under automation) on this Channel's profile at `url`, and
 * resolves "closed" once the Member closes it. The window is never killed: killing Chrome can lose
 * a login it has not written to disk yet. After `maxMs` this stops waiting ("still_open") and
 * leaves the window as it is. Call inside withChannelLock.
 */
export async function openPlainChrome(channelId: string, url: string, maxMs: number): Promise<"closed" | "still_open"> {
  const chrome = chromePath();
  if (!chrome) throw new Error("Google Chrome is not installed.");
  const dir = profileDir(channelId);
  await mkdir(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", url],
      { stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      child.unref();
      resolve("still_open");
    }, maxMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolve("closed");
    });
  });
}

/**
 * Holds a database lock for one Channel's browser, so no two tasks open its profile at once.
 * `fn` gets the lock's own database connection, for small reads while the task runs.
 */
export async function withChannelLock<T>(
  channelId: string,
  waitMs: number,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();
  try {
    const key = `browser:${channelId}`;
    const started = Date.now();
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [key]);
      if (rows[0]?.locked) break;
      if (Date.now() - started > waitMs) {
        throw new ConnectorError("retryable", "This Channel's browser is busy with another task.");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    try {
      return await fn(client);
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [key]).catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export type BrowserTask<T> = (page: Page, context: BrowserContext) => Promise<T>;

/** Minimizes the window, or restores it and brings it to the front. */
export async function setWindowShown(page: Page, shown: boolean): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: shown ? "normal" : "minimized" } });
    await session.detach().catch(() => {});
    if (shown) await page.bringToFront();
  } catch {
    // Showing or hiding the window never fails the task.
  }
}

/** The Channel's "Show window" choice: whether its posting window is on screen. */
async function showWindowSetting(client: Client, channelId: string): Promise<boolean> {
  const { rows } = await client.query<{ show: boolean | null }>(
    "select (settings->>'showWindow')::boolean as show from channels where id = $1",
    [channelId],
  );
  return rows[0]?.show === true;
}

/**
 * Opens this Channel's own Chrome window, runs the task, and closes the window.
 * The window starts minimized unless the Member chose Show window for this Channel; switching
 * that on or off while the task runs shows or hides the window within a few seconds.
 * `screenshotName` names the screenshot saved when the task fails.
 */
export async function withChannelBrowser<T>(
  channelId: string,
  task: BrowserTask<T>,
  options: { lockWaitMs?: number; screenshotName?: string } = {},
): Promise<T> {
  return withChannelLock(channelId, options.lockWaitMs ?? 10 * 60_000, async (client) => {
    const { chromium } = await import("playwright");
    const dir = profileDir(channelId);
    await mkdir(dir, { recursive: true });
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(dir, {
        channel: "chrome",
        headless: false,
        viewport: null,
        // A minimized window keeps rendering and running timers, so pages behave as when shown.
        args: ["--window-size=1280,900", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"],
      });
    } catch (cause) {
      throw new ConnectorError(
        "retryable",
        "Google Chrome could not be opened. Check that Chrome is installed and not blocked.",
        { cause },
      );
    }
    const page = context.pages()[0] ?? (await context.newPage());
    let shown = await showWindowSetting(client, channelId).catch(() => false);
    if (!shown) await setWindowShown(page, false);
    // Follows the Show window button while the task runs. Only a change acts, so a window
    // brought forward for a login check is never hidden again by this.
    const follow = setInterval(() => {
      showWindowSetting(client, channelId)
        .then(async (wanted) => {
          if (wanted === shown) return;
          shown = wanted;
          await setWindowShown(page, wanted);
        })
        .catch(() => {});
    }, 3000);
    try {
      return await task(page, context);
    } catch (error) {
      if (error instanceof PageChanged) {
        const file = await screenshot(page, options.screenshotName ?? channelId);
        const shot = `Screenshot: ${file ?? "could not be taken"}.`;
        if (error.afterSend) {
          throw new ConnectorError(
            "outcome_unknown",
            `The post was sent, but "${error.step}" did not appear, so it is not known whether it went live. ${shot}`,
          );
        }
        throw new ConnectorError("rejected", `The page changed at "${error.step}", so the script needs updating. ${shot}`);
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        // A step the script did not wrap in expectVisible, such as a click something covered.
        const file = await screenshot(page, options.screenshotName ?? channelId);
        const step = error.message.split("\n")[0].replace(/\s*Call log:.*$/, "");
        throw new ConnectorError(
          "rejected",
          `A step on the page did not work (${step}), so the script needs updating. Screenshot: ${file ?? "could not be taken"}.`,
        );
      }
      throw error;
    } finally {
      clearInterval(follow);
      await context.close().catch(() => {});
    }
  });
}

async function screenshot(page: Page, name: string): Promise<string | null> {
  try {
    const dir = dataPath("screenshots");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}

/**
 * A page did not look as the script expected. `afterSend` marks a step after the post button was
 * pressed: the post may be live, so it is never retried automatically.
 */
export class PageChanged extends Error {
  constructor(
    readonly step: string,
    readonly afterSend = false,
  ) {
    super(`Page changed at ${step}`);
    this.name = "PageChanged";
  }
}

/** Waits for a locator to be visible; if it never is, the page has changed. */
export async function expectVisible(
  locator: Locator,
  step: string,
  timeoutMs = 30_000,
  afterSend = false,
): Promise<Locator> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    return locator.first();
  } catch {
    throw new PageChanged(step, afterSend);
  }
}

/** The first of these candidates that shows up: sites move fields around, so scripts try a few. */
export async function firstVisible(candidates: Locator[], step: string, timeoutMs = 30_000): Promise<Locator> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const candidate of candidates) {
      if (await candidate.first().isVisible().catch(() => false)) return candidate.first();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new PageChanged(step);
}

/** Waits until a button can be pressed, such as Post once an upload has finished. */
export async function waitEnabled(locator: Locator, step: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const button = locator.first();
    const enabled =
      (await button.isEnabled().catch(() => false)) && (await button.getAttribute("aria-disabled").catch(() => null)) !== "true";
    if (enabled) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new PageChanged(step);
}

/**
 * Replaces the text of a rich editor the way a person would: select all, then type. A menu or
 * tip left open over the editor (TikTok opens some) is closed first; if something still covers
 * it, the editor is focused directly instead of clicked.
 */
export async function replaceText(page: Page, editor: Locator, text: string): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  try {
    await editor.click({ timeout: 5000 });
  } catch {
    await editor.focus();
  }
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  if (text) await page.keyboard.insertText(text);
}

/** True when the first of these locators is visible right now. */
export async function anyVisible(locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    if (await locator.first().isVisible().catch(() => false)) return true;
  }
  return false;
}

export type SiteChecks = {
  /** The cookie that exists only while logged in, such as "auth_token" on x.com. */
  loggedIn(context: BrowserContext): Promise<boolean>;
  /** A login check, code or CAPTCHA is on screen. */
  challenged(page: Page): Promise<boolean>;
  /** Where to send the Member to log in. */
  loginUrl: string;
};

export async function hasCookie(context: BrowserContext, url: string, name: string): Promise<boolean> {
  const cookies = await context.cookies(url);
  return cookies.some((cookie) => cookie.name === name && cookie.value !== "" && cookie.value !== "0");
}

/** Common signs of a verification page: a CAPTCHA frame or words asking to verify. */
export async function looksLikeChallenge(page: Page): Promise<boolean> {
  const url = page.url();
  if (/captcha|challenge|checkpoint|verify|two[-_]?factor|account_access/i.test(url)) return true;
  return anyVisible([
    page.locator('iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="arkoselabs" i]'),
    page.getByText(/verify (it'?s you|you are human|you're human)|security check|enter the code|confirmation code/i),
  ]);
}

export const ATTENTION_WAIT_MS = 60 * 60_000;

/**
 * If the site wants a login check, hands it to the Member and waits until it is cleared:
 * the window comes to the front, the Delivery shows as Needs attention, and the Member is
 * notified. Gives up after an hour.
 */
export async function clearChallenges(
  page: Page,
  context: BrowserContext,
  site: SiteChecks,
  attention: AttentionHooks | undefined,
  options: { goToLogin?: boolean } = {},
): Promise<void> {
  const blocked = async () => !(await site.loggedIn(context)) || (await site.challenged(page));
  if (!(await blocked())) return;
  if (!attention) throw new ConnectorError("auth", "This Channel needs logging in again in its browser window.");

  if (options.goToLogin !== false && !(await site.loggedIn(context))) {
    await page.goto(site.loginUrl).catch(() => {});
  }
  await setWindowShown(page, true);
  const loggedOut = !(await site.loggedIn(context));
  await attention.needed(
    loggedOut ? "Log in to this account in its browser window." : "Clear the check (code or CAPTCHA) in the browser window.",
  );

  const started = Date.now();
  while (await blocked()) {
    if (Date.now() - started > ATTENTION_WAIT_MS) {
      throw new ConnectorError("rejected", "Nobody cleared the login check within an hour. Retry when you are at the laptop.");
    }
    if (await attention.bringForwardRequested()) await setWindowShown(page, true);
    await page.waitForTimeout(3000);
  }
  await attention.resolved();
}
