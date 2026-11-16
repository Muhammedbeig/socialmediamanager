import { and, eq, isNotNull, lte } from "drizzle-orm";
import { getNetwork, networkName } from "@/connectors/registry";
import type { Db } from "@/db/client";
import { channels } from "@/db/schema";
import { type DesktopNotifier, raiseAlert } from "@/notify";
import { decryptToken, encryptToken } from "@/secrets/tokens";

/** Logins are refreshed when they have this long left. */
export const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60_000;

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
    const refresh = getNetwork(channel.network)?.auth?.refresh;
    if (!refresh || !channel.tokenEncrypted) continue;
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
