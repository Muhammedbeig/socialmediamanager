import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { needsReconnect } from "@/channels/connect";
import { getConnector, networkName } from "@/connectors/registry";
import type { Db } from "@/db/client";
import { type CropRect, type TrimRange, brands, channels, deliveries, mediaAssets, postMedia, posts } from "@/db/schema";
import { type DraftMedia, canPublish, checkPost } from "@/domain/checks";
import { UserError } from "@/domain/errors";
import { type PostStatus, computePostStatus } from "@/domain/post-status";

export type NewPost = {
  brandId: string;
  caption: string;
  /** Media in the order it should appear. */
  assetIds: string[];
  /** One entry per Channel the Post goes to. */
  deliveries: {
    channelId: string;
    captionOverride: string | null;
    approvedCrops: Record<string, CropRect>;
    /** Video trims the Member approved, by asset ID. */
    approvedTrims?: Record<string, TrimRange>;
    /** Values for the network's extra fields, such as a YouTube title. */
    fields?: Record<string, string>;
  }[];
  /** Null publishes now. */
  scheduledFor: Date | null;
};

const MAX_MEDIA = 20;

/**
 * Saves a Post with one Scheduled Delivery per Channel.
 * The pre-publish checks run again here, so nothing a Channel cannot take is ever saved.
 */
export async function createPost(db: Db, memberId: string, input: NewPost, now = new Date()) {
  const [brand] = await db.select().from(brands).where(eq(brands.id, input.brandId));
  if (!brand) throw new UserError("That Brand no longer exists.");

  const channelIds = [...new Set(input.deliveries.map((delivery) => delivery.channelId))];
  if (channelIds.length === 0) throw new UserError("Pick at least one Channel.");
  if (channelIds.length !== input.deliveries.length) throw new UserError("A Channel was picked twice.");

  if (input.scheduledFor) {
    if (Number.isNaN(input.scheduledFor.getTime())) throw new UserError("Pick a date and time to schedule the Post.");
    if (input.scheduledFor.getTime() < now.getTime() - 60_000) throw new UserError("Pick a time in the future.");
  }

  const channelRows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.brandId, brand.id), inArray(channels.id, channelIds)));
  if (channelRows.length !== channelIds.length) {
    throw new UserError(`A picked Channel is no longer part of ${brand.name}.`);
  }

  if (input.assetIds.length > MAX_MEDIA) throw new UserError(`A Post can hold up to ${MAX_MEDIA} files.`);
  if (new Set(input.assetIds).size !== input.assetIds.length) throw new UserError("A file was added twice.");
  const assetRows =
    input.assetIds.length > 0 ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, input.assetIds)) : [];
  if (assetRows.length !== input.assetIds.length) throw new UserError("A file is no longer in the media library.");
  const media: DraftMedia[] = input.assetIds.map((assetId) => {
    const asset = assetRows.find((row) => row.id === assetId)!;
    return {
      assetId,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
    };
  });

  const caption = input.caption.trimEnd();
  const problems: string[] = [];
  const deliveryValues = input.deliveries.map((delivery) => {
    const channel = channelRows.find((row) => row.id === delivery.channelId)!;
    const label = `${channel.displayName} on ${networkName(channel.network)}`;
    const override = delivery.captionOverride?.trimEnd() ?? null;
    const connector = getConnector(channel.network);
    // Keep only crops for files in this Post.
    const approvedCrops = Object.fromEntries(
      Object.entries(delivery.approvedCrops).filter(([assetId]) => input.assetIds.includes(assetId)),
    );
    const approvedTrims = Object.fromEntries(
      Object.entries(delivery.approvedTrims ?? {}).filter(([assetId]) => input.assetIds.includes(assetId)),
    );

    if (needsReconnect(channel, now)) {
      problems.push(`${label} needs reconnecting first.`);
    } else if (!connector) {
      problems.push(`Publishing to ${networkName(channel.network)} is not available yet.`);
    } else {
      const issues = checkPost(
        { caption: override ?? caption, media, approvedCrops, approvedTrims, fields: delivery.fields ?? {} },
        connector.baseCapabilities,
        networkName(channel.network),
      );
      if (!canPublish(issues)) {
        for (const issue of issues) {
          if (issue.kind === "block") problems.push(`${label}: ${issue.message}`);
          if (issue.kind === "crop" && !issue.approved) problems.push(`${label}: approve the crop first.`);
          if (issue.kind === "trim" && !issue.approved) problems.push(`${label}: approve the trim first.`);
        }
      }
    }
    return {
      channelId: channel.id,
      captionOverride: override !== null && override !== caption ? override : null,
      approvedCrops,
      approvedTrims,
      fields: delivery.fields ?? {},
      scheduledFor: input.scheduledFor ?? now,
    };
  });
  if (problems.length > 0) throw new UserError(problems.join(" "));

  return db.transaction(async (tx) => {
    const [post] = await tx
      .insert(posts)
      .values({ brandId: brand.id, caption, scheduledFor: input.scheduledFor, createdBy: memberId })
      .returning();
    if (input.assetIds.length > 0) {
      await tx
        .insert(postMedia)
        .values(input.assetIds.map((assetId, position) => ({ postId: post.id, assetId, position })));
    }
    const created = await tx
      .insert(deliveries)
      .values(deliveryValues.map((delivery) => ({ ...delivery, postId: post.id })))
      .returning();
    return { post, deliveries: created };
  });
}

export type PostSummary = {
  id: string;
  brandName: string;
  caption: string;
  scheduledFor: Date | null;
  createdAt: Date;
  status: PostStatus;
  firstAssetId: string | null;
  mediaCount: number;
  deliveries: { id: string; status: (typeof deliveries.$inferSelect)["status"]; channelName: string; network: (typeof channels.$inferSelect)["network"] }[];
};

/** Posts, newest first, each with its computed Post status. */
export async function listPosts(db: Db, limit = 100, offset = 0): Promise<PostSummary[]> {
  const postRows = await db
    .select({ post: posts, brandName: brands.name })
    .from(posts)
    .innerJoin(brands, eq(posts.brandId, brands.id))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit)
    .offset(offset);
  if (postRows.length === 0) return [];
  const postIds = postRows.map((row) => row.post.id);

  const [deliveryRows, mediaRows] = await Promise.all([
    db
      .select({ delivery: deliveries, channelName: channels.displayName, network: channels.network })
      .from(deliveries)
      .innerJoin(channels, eq(deliveries.channelId, channels.id))
      .where(and(inArray(deliveries.postId, postIds), eq(deliveries.superseded, false)))
      .orderBy(asc(channels.network), asc(channels.displayName)),
    db.select().from(postMedia).where(inArray(postMedia.postId, postIds)).orderBy(asc(postMedia.position)),
  ]);

  return postRows.map(({ post, brandName }) => {
    const own = deliveryRows.filter((row) => row.delivery.postId === post.id);
    const media = mediaRows.filter((row) => row.postId === post.id);
    return {
      id: post.id,
      brandName,
      caption: post.caption,
      scheduledFor: post.scheduledFor,
      createdAt: post.createdAt,
      status: computePostStatus(own.map((row) => row.delivery.status)),
      firstAssetId: media[0]?.assetId ?? null,
      mediaCount: media.length,
      deliveries: own.map((row) => ({
        id: row.delivery.id,
        status: row.delivery.status,
        channelName: row.channelName,
        network: row.network,
      })),
    };
  });
}
