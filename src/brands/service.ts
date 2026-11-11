import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { brands, channels, posts } from "@/db/schema";
import { UserError } from "@/domain/errors";

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new UserError("Give the Brand a name.");
  if (name.length > 80) throw new UserError("Keep the Brand name under 80 characters.");
  return name;
}

async function assertNameFree(db: Db, name: string, exceptId?: string) {
  const rows = await db
    .select({ id: brands.id })
    .from(brands)
    .where(sql`lower(${brands.name}) = lower(${name})`);
  if (rows.some((row) => row.id !== exceptId)) {
    throw new UserError(`A Brand named "${name}" already exists.`);
  }
}

export async function listBrands(db: Db) {
  return db.select().from(brands).orderBy(asc(brands.name));
}

export async function listBrandsWithChannels(db: Db) {
  const [brandRows, channelRows] = await Promise.all([
    listBrands(db),
    db.select().from(channels).orderBy(asc(channels.network), asc(channels.displayName)),
  ]);
  return brandRows.map((brand) => ({
    ...brand,
    channels: channelRows.filter((channel) => channel.brandId === brand.id),
  }));
}

export async function createBrand(db: Db, rawName: string) {
  const name = cleanName(rawName);
  await assertNameFree(db, name);
  const [brand] = await db.insert(brands).values({ name }).returning();
  return brand;
}

export async function renameBrand(db: Db, id: string, rawName: string) {
  const name = cleanName(rawName);
  await assertNameFree(db, name, id);
  const [brand] = await db.update(brands).set({ name }).where(eq(brands.id, id)).returning();
  if (!brand) throw new UserError("That Brand no longer exists.");
  return brand;
}

export async function deleteBrand(db: Db, id: string) {
  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.brandId, id)).limit(1);
  if (channel) {
    throw new UserError("This Brand still has Channels. Move or disconnect them first.");
  }
  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.brandId, id)).limit(1);
  if (post) throw new UserError("This Brand has Posts, so it cannot be deleted.");
  await db.delete(brands).where(eq(brands.id, id));
}
