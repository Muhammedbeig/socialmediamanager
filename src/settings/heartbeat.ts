import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

// The worker writes a heartbeat every few seconds, so the web app can tell whether anything
// is publishing. Without a running worker, Posts are saved but never go out.

const KEY = "worker_heartbeat";
/** A heartbeat older than this means the worker is not running. */
export const HEARTBEAT_STALE_MS = 60_000;

export async function beat(db: Db, now: Date): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEY, value: now.toISOString() })
    .onConflictDoUpdate({ target: settings.key, set: { value: now.toISOString() } });
}

export async function lastHeartbeat(db: Db): Promise<Date | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return typeof row?.value === "string" ? new Date(row.value) : null;
}

export function workerRunning(last: Date | null, now = new Date()): boolean {
  return last !== null && now.getTime() - last.getTime() < HEARTBEAT_STALE_MS;
}
