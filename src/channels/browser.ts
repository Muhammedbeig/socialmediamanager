import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import {
  type SiteChecks,
  openPlainChrome,
  profileDir,
  withChannelBrowser,
  withChannelLock,
} from "@/connectors/browser/engine";
import { getConnector, getNetwork, networkName } from "@/connectors/registry";
import type { Db } from "@/db/client";
import { type Network, brands, channels } from "@/db/schema";
import { UserError } from "@/domain/errors";
import { type DesktopNotifier, raiseAlert } from "@/notify";

// Browser Channels (TikTok, Pinterest, X) have no OAuth. The Member adds the account, and the
// worker opens that Channel's own Chrome window at the network's login page. The Member logs in
// there once and closes the window; its profile keeps the session for later Deliveries.

/** How long the app waits for a login window to be closed. The window itself is never killed. */
export const LOGIN_WAIT_MS = 2 * 60 * 60_000;

function cleanHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/\/.*$/, "");
  return handle.length > 0 ? handle.slice(0, 100) : null;
}

export async function addBrowserChannel(
  db: Db,
  input: { brandId: string; network: string; displayName: string; handle: string },
) {
  const entry = getNetwork(input.network);
  if (!entry || entry.kind !== "browser") throw new UserError("That network is not added this way.");
  const [brand] = await db.select().from(brands).where(eq(brands.id, input.brandId));
  if (!brand) throw new UserError("That Brand no longer exists.");
  const displayName = input.displayName.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!displayName) throw new UserError("Give the account a name, such as Acme on TikTok.");

  const [channel] = await db
    .insert(channels)
    .values({
      brandId: brand.id,
      network: entry.network,
      connectorKind: "browser",
      displayName,
      handle: cleanHandle(input.handle),
      externalId: `browser:${randomUUID()}`,
      status: "reconnect_needed",
      settings: { loginRequestedAt: new Date().toISOString() },
    })
    .returning();
  return channel;
}

/** Asks the worker to open this Channel's window at the login page. */
export async function requestLogin(db: Db, channelId: string) {
  const [channel] = await db
    .update(channels)
    .set({
      settings: sql`(${channels.settings} - 'loginError') || jsonb_build_object('loginRequestedAt', ${new Date().toISOString()}::text)`,
    })
    .where(and(eq(channels.id, channelId), eq(channels.connectorKind, "browser")))
    .returning();
  if (!channel) throw new UserError("That Channel no longer exists.");
  return channel;
}

/** X only: whether the account has Premium, which allows long posts and editing. */
export async function setPremium(db: Db, channelId: string, premium: boolean) {
  const [channel] = await db
    .update(channels)
    .set({ settings: sql`${channels.settings} || jsonb_build_object('premium', ${premium}::boolean)` })
    .where(and(eq(channels.id, channelId), eq(channels.network, "x")))
    .returning();
  if (!channel) throw new UserError("That Channel no longer exists.");
  return channel;
}

/**
 * Show window: whether this Channel's posting window is on screen, to watch the automation.
 * Off by default (the window opens minimized). Takes effect within seconds, even mid-post.
 */
export async function setShowWindow(db: Db, channelId: string, show: boolean) {
  const [channel] = await db
    .update(channels)
    .set({ settings: sql`${channels.settings} || jsonb_build_object('showWindow', ${show}::boolean)` })
    .where(and(eq(channels.id, channelId), eq(channels.connectorKind, "browser")))
    .returning();
  if (!channel) throw new UserError("That Channel no longer exists.");
  return channel;
}

/** At start-up: a login window from before a restart is gone, so it no longer counts as open. */
export async function clearStaleLogins(db: Db) {
  await db
    .update(channels)
    .set({ settings: sql`${channels.settings} - 'loginStartedAt'` })
    .where(and(eq(channels.connectorKind, "browser"), sql`${channels.settings} ? 'loginStartedAt'`));
}

/** Forgets the browser session too, so a disconnected account is really logged out here. */
export async function forgetBrowserProfile(channelId: string) {
  await rm(profileDir(channelId), { recursive: true, force: true }).catch(() => {});
}

/**
 * Starts one waiting login request, if any, and returns without waiting for it, so several
 * Channels' windows can be open at once (each on its own profile). Opens a plain Chrome window
 * (not under automation, so "Sign in with Google" works) at the login page. Once the Member closes
 * it, the profile is checked for a logged-in session.
 */
export async function runNextLogin(db: Db, options: { desktop?: DesktopNotifier; log?: (m: string) => void } = {}) {
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.connectorKind, "browser"), sql`${channels.settings} ? 'loginRequestedAt'`))
    .limit(1);
  if (!channel) return false;
  const connector = getConnector(channel.network as Network);
  const site = connector?.site;
  const label = `${channel.displayName} on ${networkName(channel.network)}`;
  // Taken off the list first, so a failure never loops.
  await db
    .update(channels)
    .set({ settings: sql`(${channels.settings} - 'loginRequestedAt') || jsonb_build_object('loginStartedAt', ${new Date().toISOString()}::text)` })
    .where(eq(channels.id, channel.id));
  if (!site) return true;
  void finishLogin(db, channel.id, label, site, options).catch((cause) =>
    options.log?.(`Login for ${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`),
  );
  return true;
}

async function finishLogin(
  db: Db,
  channelId: string,
  label: string,
  site: SiteChecks,
  options: { desktop?: DesktopNotifier; log?: (m: string) => void },
) {
  const channel = { id: channelId };
  let error: string | null = null;
  try {
    const ended = await withChannelLock(channel.id, 60_000, async () => {
      await raiseAlert(
        db,
        {
          kind: "needs_attention",
          title: `Log in to ${label}`,
          body: "Its Chrome window is open at the login page. Log in, then close that window.",
          link: "/channels",
        },
        options.desktop,
      );
      return openPlainChrome(channel.id, site.loginUrl, LOGIN_WAIT_MS);
    });
    if (ended === "still_open") {
      error = "The window was still open after 2 hours. Close it, then use Log in again.";
    } else {
      const loggedIn = await withChannelBrowser(channel.id, async (_page, context) => site.loggedIn(context), {
        lockWaitMs: 60_000,
      });
      if (!loggedIn) error = "The window was closed before the login finished.";
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  if (error) {
    await db
      .update(channels)
      .set({ settings: sql`(${channels.settings} - 'loginStartedAt') || jsonb_build_object('loginError', ${error}::text)` })
      .where(eq(channels.id, channel.id));
    options.log?.(`Login for ${label} did not finish: ${error}`);
  } else {
    await db
      .update(channels)
      .set({
        status: "connected",
        settings: sql`(${channels.settings} - 'loginError' - 'loginStartedAt') || jsonb_build_object('loggedInAt', ${new Date().toISOString()}::text)`,
      })
      .where(eq(channels.id, channel.id));
    options.log?.(`${label} is logged in.`);
  }
}
