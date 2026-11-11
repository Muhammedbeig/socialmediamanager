import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { requireEnv } from "@/env";

// Tests never touch the real database: they need TEST_DATABASE_URL, and its name must say "test".
export async function openTestDb() {
  const url = requireEnv("TEST_DATABASE_URL");
  if (!new URL(url).pathname.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point at a database with 'test' in its name.");
  }
  const handle = createDb(url);
  await runMigrations(handle.db);
  return handle;
}

export async function resetTestDb(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE members, brands, channels, media_assets, media_variants, posts, post_media,
      deliveries, delivery_events, notifications, settings
    RESTART IDENTITY CASCADE
  `);
}
