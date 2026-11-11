import type { Db } from "./client";
import { members } from "./schema";

// v1 has one Member: the owner. Safe to run more than once.
export async function seedOwner(db: Db) {
  const existing = await db.select().from(members).limit(1);
  if (existing.length > 0) return existing[0];
  const [owner] = await db.insert(members).values({ name: "Owner", role: "admin" }).returning();
  return owner;
}
