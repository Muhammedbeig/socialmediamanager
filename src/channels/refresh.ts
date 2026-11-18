import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { connectOptionFor, networkName } from "@/connectors/registry";
import type { Db } from "@/db/client";
import { channels } from "@/db/schema";
import { type DesktopNotifier, raiseAlert } from "@/notify";
import { decryptToken, encryptToken } from "@/secrets/tokens";

/** Logins are refreshed when they have this long left. */
export const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60_000;

/** How long before a login that cannot be extended ends the Member is reminded to reconnect it. */
export const REMIND_BEFORE_MS = 24 * 60 * 60_000;

type ChannelRow = typeof channels.$inferSelect;

/**
 * For a login the app cannot extend: one reminder a day before it ends, then, once it has ended,
 * the Channel is marked for reconnecting with an alert.
 */
async function remindBeforeExpiry(db: Db, channel: ChannelRow, now: Date, options: { desktop?: DesktopNotifier }) {
  const ends = channel.tokenExpiresAt!;
  const label = `${channel.displayName} on ${networkName(channel.network)}`;
  if (ends.getTime() <= now.getTime()) {
    await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, channel.id));
    await raiseAlert(
      db,
      {
        kind: "channel_reconnect",
        title: `Reconnect ${label}`,
        body: "Its login has ended. Posts cannot go out to it until you reconnect it on the Channels screen.",
        link: "/channels",
      },
      options.desktop,
    );
    return;
  }
  const warnedFor = channel.settings.expiryReminderFor;
  if (ends.getTime() - now.getTime() > REMIND_BEFORE_MS || warnedFor === ends.toISOString()) return;
  await db
    .update(channels)
    .set({ settings: sql`${channels.settings} || jsonb_build_object('expiryReminderFor', ${ends.toISOString()}::text)` })
    .where(eq(channels.id, channel.id));
  await raiseAlert(
    db,
    {
      kind: "channel_reconnect",
      title: `Reconnect ${label} soon`,
      body: `Its login ends ${ends.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Reconnect it on the Channels screen; it takes a few seconds.`,
      link: "/channels",
    },
    options.desktop,
  );
}

/**
 * Extends every login that expires soon, so scheduled Posts never meet an expired token.
 * A login that runs out before it could be refreshed marks its Channel for reconnecting and raises an alert.
 */
export async function refreshExpiringTokens(
  db: Db,
  now: Date,
  options: { desktop?: DesktopNotifier } = {},
): Promise<{ refreshed: number; failed: number }> {
  const soon = new Date(now.getTime() + REFRESH_WINDOW_MS);
  const rows = await db
    .select()
    .from(channels)
    .where(
      and(eq(channels.status, "connected"), isNotNull(channels.tokenExpiresAt), lte(channels.tokenExpiresAt, soon)),
    );

  let refreshed = 0;
  let failed = 0;
  for (const channel of rows) {
    const refresh = connectOptionFor(channel)?.auth?.refresh;
    if (!refresh || !channel.tokenEncrypted) {
      // A login the app cannot extend, such as YouTube while the Google app is in Testing.
      await remindBeforeExpiry(db, channel, now, options);
      continue;
    }
    try {
      const fresh = await refresh(await decryptToken(channel.tokenEncrypted));
      await db
        .update(channels)
        .set({ tokenEncrypted: await encryptToken(fresh.accessToken), tokenExpiresAt: fresh.expiresAt })
        .where(eq(channels.id, channel.id));
      refreshed++;
    } catch (error) {
      failed++;
      // Before expiry, try again on the next run. Once expired, alert once: the Channel then
      // leaves this list because it is no longer "connected".
      if (channel.tokenExpiresAt!.getTime() > now.getTime()) continue;
      await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, channel.id));
      await raiseAlert(
        db,
        {
          kind: "channel_reconnect",
          title: `Reconnect ${channel.displayName} on ${networkName(channel.network)}`,
          body: `Its login has expired and could not be extended${error instanceof Error ? `: ${error.message}` : "."} Posts cannot go out to it until you reconnect it.`,
          link: "/channels",
        },
        options.desktop,
      );
    }
  }
  return { refreshed, failed };
}
