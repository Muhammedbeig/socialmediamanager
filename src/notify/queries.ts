import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { channels, deliveries, notifications, posts } from "@/db/schema";

/** Deliveries paused at a login check, plus browser Channels with a login window open. */
export async function needsAttentionCount(db: Db): Promise<number> {
  const [paused] = await db.select({ value: count() }).from(deliveries).where(eq(deliveries.status, "needs_attention"));
  const [logins] = await db
    .select({ value: count() })
    .from(channels)
    .where(and(eq(channels.connectorKind, "browser"), sql`${channels.settings} ? 'loginStartedAt'`));
  return (paused?.value ?? 0) + (logins?.value ?? 0);
}

/** Alerts not yet read: the number on the in-app badge. */
export async function unreadAlertCount(db: Db): Promise<number> {
  const [row] = await db.select({ value: count() }).from(notifications).where(isNull(notifications.readAt));
  return row?.value ?? 0;
}

export async function listAlerts(db: Db, limit = 100) {
  const rows = await db
    .select({ alert: notifications, postId: deliveries.postId })
    .from(notifications)
    .leftJoin(deliveries, eq(deliveries.id, notifications.deliveryId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map(({ alert, postId }) => ({
    ...alert,
    link: postId ? `/posts/${postId}` : alert.kind === "channel_reconnect" ? "/channels" : null,
  }));
}

export async function markAlertsRead(db: Db, ids?: string[]) {
  const unread = isNull(notifications.readAt);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids ? and(unread, inArray(notifications.id, ids)) : unread);
}

/** What the Dashboard shows: Posts coming up and Deliveries that failed recently. */
export async function dashboardData(db: Db, now: Date) {
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const [upcoming, failures] = await Promise.all([
    db
      .select({ delivery: deliveries, channelName: channels.displayName, network: channels.network, caption: posts.caption })
      .from(deliveries)
      .innerJoin(channels, eq(channels.id, deliveries.channelId))
      .innerJoin(posts, eq(posts.id, deliveries.postId))
      .where(and(eq(deliveries.status, "scheduled"), eq(deliveries.superseded, false), gte(deliveries.scheduledFor, now)))
      .orderBy(deliveries.scheduledFor)
      .limit(50),
    db
      .select({ delivery: deliveries, channelName: channels.displayName, network: channels.network, caption: posts.caption })
      .from(deliveries)
      .innerJoin(channels, eq(channels.id, deliveries.channelId))
      .innerJoin(posts, eq(posts.id, deliveries.postId))
      .where(and(eq(deliveries.status, "failed"), eq(deliveries.superseded, false), gte(deliveries.createdAt, weekAgo)))
      .orderBy(desc(deliveries.createdAt))
      .limit(20),
  ]);
  return { upcoming: upcoming.filter((row) => row.delivery.scheduledFor <= weekAhead), failures };
}
