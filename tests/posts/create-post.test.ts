import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { brands, channels, deliveries, mediaAssets, postMedia } from "@/db/schema";
import { seedOwner } from "@/db/seed";
import { UserError } from "@/domain/errors";
import { type NewPost, createPost, listPosts } from "@/posts/service";
import { openTestDb, resetTestDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
let ownerId: string;
let brandId: string;
let fakeA: string;
let fakeB: string;
const NOW = new Date("2026-11-11T09:00:00Z");

beforeAll(async () => {
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
});
afterAll(() => close?.());

beforeEach(async () => {
  await resetTestDb(db);
  ownerId = (await seedOwner(db)).id;
  const [brand] = await db.insert(brands).values({ name: "Acme" }).returning();
  brandId = brand.id;
  const rows = await db
    .insert(channels)
    .values(
      ["fake-1", "fake-2"].map((externalId) => ({
        brandId,
        network: "fake" as const,
        connectorKind: "api" as const,
        displayName: `Acme ${externalId}`,
        externalId,
      })),
    )
    .returning();
  [fakeA, fakeB] = rows.map((row) => row.id);
});

async function image(width: number, height: number, sha = `${width}x${height}`) {
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      kind: "image",
      originalName: `${sha}.jpg`,
      path: `originals/${sha}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1000,
      width,
      height,
      sha256: sha,
    })
    .returning();
  return asset.id;
}

function post(overrides: Partial<NewPost> = {}): NewPost {
  return {
    brandId,
    caption: "Hello",
    assetIds: [],
    deliveries: [
      { channelId: fakeA, captionOverride: null, approvedCrops: {} },
      { channelId: fakeB, captionOverride: null, approvedCrops: {} },
    ],
    scheduledFor: null,
    ...overrides,
  };
}

describe("createPost", () => {
  it("saves one Scheduled Delivery per Channel, due now when publishing now", async () => {
    const { post: saved, deliveries: rows } = await createPost(db, ownerId, post(), NOW);
    expect(saved.scheduledFor).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "scheduled" && row.scheduledFor.getTime() === NOW.getTime())).toBe(true);
  });

  it("keeps the media order and a per-Channel caption", async () => {
    const first = await image(1000, 1000, "a");
    const second = await image(1000, 1000, "b");
    const { post: saved, deliveries: rows } = await createPost(
      db,
      ownerId,
      post({
        assetIds: [second, first],
        deliveries: [
          { channelId: fakeA, captionOverride: "Only for A", approvedCrops: {} },
          { channelId: fakeB, captionOverride: "Hello", approvedCrops: {} },
        ],
      }),
      NOW,
    );
    const media = await db.select().from(postMedia).where(eq(postMedia.postId, saved.id));
    expect(media.sort((x, y) => x.position - y.position).map((m) => m.assetId)).toEqual([second, first]);
    expect(rows.find((row) => row.channelId === fakeA)!.captionOverride).toBe("Only for A");
    // An override that matches the main caption is not stored.
    expect(rows.find((row) => row.channelId === fakeB)!.captionOverride).toBeNull();
  });

  it("schedules every Delivery for the chosen time", async () => {
    const at = new Date("2026-11-12T08:30:00Z");
    const { post: saved, deliveries: rows } = await createPost(db, ownerId, post({ scheduledFor: at }), NOW);
    expect(saved.scheduledFor?.toISOString()).toBe(at.toISOString());
    expect(rows.every((row) => row.scheduledFor.toISOString() === at.toISOString())).toBe(true);
  });

  it("refuses a time in the past", async () => {
    await expect(createPost(db, ownerId, post({ scheduledFor: new Date("2026-11-10T00:00:00Z") }), NOW)).rejects.toThrow(
      /future/,
    );
  });

  it("refuses a Post with no Channels", async () => {
    await expect(createPost(db, ownerId, post({ deliveries: [] }), NOW)).rejects.toThrow(/at least one Channel/);
  });

  it("refuses a Channel of another Brand", async () => {
    const [other] = await db.insert(brands).values({ name: "Globex" }).returning();
    await expect(createPost(db, ownerId, post({ brandId: other.id }), NOW)).rejects.toThrow(/no longer part of Globex/);
  });

  it("runs the pre-publish checks again and names the Channel that cannot take the Post", async () => {
    // The fake network takes captions up to 280 characters.
    const error = (await createPost(db, ownerId, post({ caption: "x".repeat(300) }), NOW).catch((e) => e)) as UserError;
    expect(error).toBeInstanceOf(UserError);
    expect(error.message).toContain("Acme fake-1 on Fake network");
    expect(error.message).toContain("280 characters");
    expect(await db.select().from(deliveries)).toHaveLength(0);
  });

  it("needs an approved crop for a picture the wrong shape, then accepts it", async () => {
    const tall = await image(1000, 2000);
    const deliveriesWithoutCrop = [{ channelId: fakeA, captionOverride: null, approvedCrops: {} }];
    await expect(
      createPost(db, ownerId, post({ assetIds: [tall], deliveries: deliveriesWithoutCrop }), NOW),
    ).rejects.toThrow(/approve the crop/);

    const crop = { x: 0, y: 375, width: 1000, height: 1250 };
    const { deliveries: rows } = await createPost(
      db,
      ownerId,
      post({ assetIds: [tall], deliveries: [{ channelId: fakeA, captionOverride: null, approvedCrops: { [tall]: crop } }] }),
      NOW,
    );
    expect(rows[0].approvedCrops).toEqual({ [tall]: crop });
  });

  it("refuses a Channel that needs reconnecting", async () => {
    await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, fakeA));
    await expect(createPost(db, ownerId, post(), NOW)).rejects.toThrow(/needs reconnecting/);
  });
});

describe("listPosts", () => {
  it("lists Posts with their computed Post status", async () => {
    const { deliveries: rows } = await createPost(db, ownerId, post(), NOW);
    await db.update(deliveries).set({ status: "published" }).where(eq(deliveries.id, rows[0].id));
    await db.update(deliveries).set({ status: "failed" }).where(eq(deliveries.id, rows[1].id));

    const [summary] = await listPosts(db);
    expect(summary.status).toBe("partly_published");
    expect(summary.brandName).toBe("Acme");
    expect(summary.deliveries.map((d) => d.status).sort()).toEqual(["failed", "published"]);
  });
});
