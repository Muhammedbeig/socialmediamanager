import type { Db } from "@/db/client";
import { brands, channels, deliveries, posts } from "@/db/schema";
import { seedOwner } from "@/db/seed";
import { encryptToken } from "@/secrets/tokens";

/** A Brand with one connected Fake-network Channel. */
export async function fakeChannel(db: Db, externalId = "fake-1") {
  const owner = await seedOwner(db);
  const [brand] = await db.insert(brands).values({ name: `Brand ${externalId}` }).returning();
  const [channel] = await db
    .insert(channels)
    .values({
      brandId: brand.id,
      network: "fake",
      connectorKind: "api",
      displayName: `Fake ${externalId}`,
      externalId,
      tokenEncrypted: await encryptToken(`token-${externalId}`),
    })
    .returning();
  return { owner, brand, channel };
}

/** A Post with one Delivery to the Channel, due at `scheduledFor`. */
export async function deliveryTo(
  db: Db,
  setup: Awaited<ReturnType<typeof fakeChannel>>,
  options: { caption?: string; scheduledFor: Date; captionOverride?: string },
) {
  const [post] = await db
    .insert(posts)
    .values({ brandId: setup.brand.id, caption: options.caption ?? "Hello", createdBy: setup.owner.id })
    .returning();
  const [delivery] = await db
    .insert(deliveries)
    .values({
      postId: post.id,
      channelId: setup.channel.id,
      scheduledFor: options.scheduledFor,
      captionOverride: options.captionOverride ?? null,
    })
    .returning();
  return { post, delivery };
}
