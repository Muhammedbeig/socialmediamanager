import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { brands, channels, deliveries, members, posts } from "@/db/schema";
import { seedOwner } from "@/db/seed";
import { openTestDb, resetTestDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
});
afterAll(() => close?.());
beforeEach(() => resetTestDb(db));

async function makeBrand(name = "Acme") {
  const [brand] = await db.insert(brands).values({ name }).returning();
  return brand;
}

function channelValues(brandId: string, externalId: string) {
  return {
    brandId,
    network: "instagram" as const,
    connectorKind: "api" as const,
    displayName: `Acme ${externalId}`,
    externalId,
  };
}

describe("schema", () => {
  it("seeds one owner Member and stays at one when run again", async () => {
    const first = await seedOwner(db);
    const second = await seedOwner(db);
    expect(first.role).toBe("admin");
    expect(second.id).toBe(first.id);
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it("lets a Brand have several Channels on the same network", async () => {
    const brand = await makeBrand();
    await db.insert(channels).values([channelValues(brand.id, "ig-1"), channelValues(brand.id, "ig-2")]);
    const rows = await db.select().from(channels).where(eq(channels.brandId, brand.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects the same profile connected twice as a Channel", async () => {
    const brand = await makeBrand();
    await db.insert(channels).values(channelValues(brand.id, "ig-1"));
    await expect(db.insert(channels).values(channelValues(brand.id, "ig-1"))).rejects.toThrow();
  });

  it("keeps one current Delivery per Post and Channel, and allows a Replace", async () => {
    const owner = await seedOwner(db);
    const brand = await makeBrand();
    const [channel] = await db.insert(channels).values(channelValues(brand.id, "ig-1")).returning();
    const [post] = await db
      .insert(posts)
      .values({ brandId: brand.id, caption: "Hello", createdBy: owner.id })
      .returning();
    const values = { postId: post.id, channelId: channel.id, scheduledFor: new Date() };

    const [first] = await db.insert(deliveries).values(values).returning();
    expect(first.status).toBe("scheduled");
    await expect(db.insert(deliveries).values(values)).rejects.toThrow();

    await db.update(deliveries).set({ superseded: true, status: "removed" }).where(eq(deliveries.id, first.id));
    const [replacement] = await db
      .insert(deliveries)
      .values({ ...values, replacesDeliveryId: first.id })
      .returning();
    expect(replacement.replacesDeliveryId).toBe(first.id);
  });
});
