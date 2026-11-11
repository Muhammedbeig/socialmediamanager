import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "@/env";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

// One pool per process. Next.js dev reloads modules, so keep it on globalThis.
const globalForDb = globalThis as unknown as { __db?: ReturnType<typeof createDb> };

export function getDb(): Db {
  globalForDb.__db ??= createDb(requireEnv("DATABASE_URL"));
  return globalForDb.__db.db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__db?.pool.end();
  globalForDb.__db = undefined;
}
