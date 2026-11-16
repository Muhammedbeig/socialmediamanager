import { and, eq, gte, lt, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deliveries, posts } from "@/db/schema";
import { computePostStatus, type PostStatus } from "@/domain/post-status";

export type CalendarPost = { id: string; caption: string; status: PostStatus; time: Date };

/** Parses "2026-11" (or nothing: this month), in the laptop's time zone. */
export function monthStart(value: string | undefined, now = new Date()): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return new Date(Number(match[1]), month - 1, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Day key in the laptop's time zone, such as "2026-11-16". */
export function dayKey(date: Date): string {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Posts of one month by day: a Post appears on the day it went out, or is due to go out.
 * Removed Posts are left out.
 */
export async function calendarMonth(db: Db, start: Date): Promise<Map<string, CalendarPost[]>> {
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const rows = await db
    .select({ delivery: deliveries, caption: posts.caption })
    .from(deliveries)
    .innerJoin(posts, eq(posts.id, deliveries.postId))
    .where(
      and(
        eq(deliveries.superseded, false),
        ne(deliveries.status, "removed"),
        gte(deliveries.scheduledFor, new Date(start.getTime() - 7 * 86_400_000)),
        lt(deliveries.scheduledFor, end),
      ),
    );

  const byPost = new Map<string, { caption: string; rows: (typeof rows)[number]["delivery"][] }>();
  for (const { delivery, caption } of rows) {
    const entry = byPost.get(delivery.postId) ?? { caption, rows: [] };
    entry.rows.push(delivery);
    byPost.set(delivery.postId, entry);
  }

  const days = new Map<string, CalendarPost[]>();
  for (const [id, { caption, rows: postRows }] of byPost) {
    const times = postRows.map((row) => row.publishedAt ?? row.scheduledFor);
    const time = new Date(Math.min(...times.map((t) => t.getTime())));
    if (time < start || time >= end) continue;
    const key = dayKey(time);
    const list = days.get(key) ?? [];
    list.push({ id, caption, status: computePostStatus(postRows.map((row) => row.status)), time });
    days.set(key, list);
  }
  for (const list of days.values()) list.sort((a, b) => a.time.getTime() - b.time.getTime());
  return days;
}
