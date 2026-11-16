import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

// Small values the app keeps between runs, such as the spacing between browser Deliveries.

export async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T | undefined) ?? null;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as never } });
}

/** Reads a value and removes it, so it is acted on once. */
export async function takeSetting<T>(db: Db, key: string): Promise<T | null> {
  const rows = await db.delete(settings).where(eq(settings.key, key)).returning();
  return (rows[0]?.value as T | undefined) ?? null;
}

export const DEFAULT_BROWSER_SPACING_MINUTES = 3;

/** Minutes between two Deliveries to the same browser network (AGENTS.md: 3 by default). */
export async function browserSpacingMinutes(db: Db): Promise<number> {
  const value = await getSetting<number>(db, "browser_spacing_minutes");
  return typeof value === "number" && value >= 0 ? value : DEFAULT_BROWSER_SPACING_MINUTES;
}

/** Asks the browser task for this Channel to bring its window to the front. */
export async function requestBringForward(db: Db, channelId: string): Promise<void> {
  await setSetting(db, `bring_forward:${channelId}`, new Date().toISOString());
}
