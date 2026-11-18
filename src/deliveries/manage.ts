import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { channelCapabilities, getConnector, networkName } from "@/connectors/registry";
import type { Capabilities, ChannelAccess, Connector } from "@/connectors/types";
import { ConnectorError } from "@/connectors/types";
import type { Db } from "@/db/client";
import {
  type RemovalResult,
  brands,
  channels,
  deliveries,
  deliveryEvents,
  mediaAssets,
  postMedia,
  posts,
} from "@/db/schema";
import { checkPost } from "@/domain/checks";
import { UserError } from "@/domain/errors";
import { computePostStatus } from "@/domain/post-status";
import { type DesktopNotifier, raiseAlert } from "@/notify";
import { deliveryMedia } from "@/jobs/run-delivery";
import { decryptToken } from "@/secrets/tokens";
import { attentionHooks } from "@/jobs/attention";
import { desktopNotifier } from "@/notify/desktop";

// What happens to a Post after it is saved: Edit, Replace, Removal and Retry, each per Delivery.

type DeliveryRow = typeof deliveries.$inferSelect;
type ChannelRow = typeof channels.$inferSelect;

async function logEvent(db: Db, deliveryId: string, type: string, detail: Record<string, unknown> = {}) {
  await db.insert(deliveryEvents).values({ deliveryId, type, detail });
}

async function loadDelivery(db: Db, deliveryId: string) {
  const [row] = await db
    .select({ delivery: deliveries, channel: channels, post: posts })
    .from(deliveries)
    .innerJoin(channels, eq(channels.id, deliveries.channelId))
    .innerJoin(posts, eq(posts.id, deliveries.postId))
    .where(eq(deliveries.id, deliveryId));
  if (!row) throw new UserError("That Delivery no longer exists.");
  return row;
}

function connectorFor(channel: ChannelRow): Connector {
  const connector = getConnector(channel.network);
  if (!connector) throw new UserError(`${networkName(channel.network)} is not available.`);
  return connector;
}

async function accessFor(channel: ChannelRow, db?: Db): Promise<ChannelAccess> {
  const browser = channel.connectorKind === "browser";
  if ((!browser && !channel.tokenEncrypted) || channel.status === "reconnect_needed") {
    throw new UserError(`${channel.displayName} on ${networkName(channel.network)} needs reconnecting first.`);
  }
  const label = `${channel.displayName} on ${networkName(channel.network)}`;
  return {
    channelId: channel.id,
    externalId: channel.externalId,
    handle: channel.handle,
    accessToken: channel.tokenEncrypted ? await decryptToken(channel.tokenEncrypted) : "",
    settings: channel.settings,
    screenshotName: `channel-${channel.id}`,
    // A browser task that meets a login check asks the Member, then carries on.
    attention: browser && db ? attentionHooks(db, { channelId: channel.id, label, desktop: desktopNotifier() }) : undefined,
  };
}

function networkError(error: unknown, channel: ChannelRow): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return `${networkName(channel.network)}: ${message}`;
}

/** Holds a live Delivery while one change runs on it, so two clicks cannot run it twice. */
async function lock(db: Db, deliveryId: string): Promise<boolean> {
  const [row] = await db
    .update(deliveries)
    .set({ inFlightSince: new Date() })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "published"), isNull(deliveries.inFlightSince)))
    .returning({ id: deliveries.id });
  return Boolean(row);
}

async function unlock(db: Db, deliveryId: string) {
  await db.update(deliveries).set({ inFlightSince: null }).where(eq(deliveries.id, deliveryId));
}

/**
 * What stops this text (and, for a Replace, this media) going to the Channel. Media that would
 * need a crop or trim cannot be approved here, so it is refused with a way forward.
 */
async function problemsFor(
  db: Db,
  delivery: DeliveryRow,
  channel: ChannelRow,
  text: string,
  capabilities: Capabilities,
  mediaIds: string[] | null,
) {
  const assets = await deliveryMedia(db, delivery.postId, mediaIds ?? delivery.mediaOverride);
  if (mediaIds && assets.length !== mediaIds.length) return ["A chosen file is no longer in the media library."];
  return checkPost(
    {
      caption: text,
      media: assets.map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
      })),
      approvedCrops: delivery.approvedCrops,
      approvedTrims: delivery.approvedTrims,
      // The Delivery's own fields, such as a Pinterest board, so required ones are not missing.
      fields: delivery.fields,
    },
    capabilities,
    networkName(channel.network),
  ).flatMap((issue) => {
    if (issue.kind === "block") return [issue.message];
    if ((issue.kind === "crop" || issue.kind === "trim") && !issue.approved) {
      return [`${issue.message} Pick a file that fits, or Duplicate the Post to ${issue.kind} it in the composer.`];
    }
    return [];
  });
}

/** Edit: changes the text of a live Delivery in place, where the network allows it. */
export async function editDelivery(db: Db, deliveryId: string, rawText: string): Promise<void> {
  const { delivery, channel, post } = await loadDelivery(db, deliveryId);
  const text = rawText.trimEnd();
  if (delivery.status !== "published" || !delivery.externalPostId) throw new UserError("Only a live Delivery can be edited.");
  const connector = connectorFor(channel);
  const access = await accessFor(channel, db);
  const capabilities = await connector.capabilities(access);
  if (!capabilities.edit.text || !connector.editText) throw new UserError(capabilities.edit.note);
  const problems = await problemsFor(db, delivery, channel, text, capabilities, null);
  if (problems.length > 0) throw new UserError(problems.join(" "));

  if (!(await lock(db, deliveryId))) throw new UserError("This Delivery is busy. Try again in a moment.");
  try {
    await connector.editText(access, { externalPostId: delivery.externalPostId, state: delivery.networkState }, text);
  } catch (error) {
    if (error instanceof ConnectorError && error.kind === "auth") {
      await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, channel.id));
    }
    await logEvent(db, deliveryId, "edit_failed", { error: networkError(error, channel) });
    throw new UserError(`The edit did not go through. ${networkError(error, channel)}`);
  } finally {
    await unlock(db, deliveryId);
  }
  await db
    .update(deliveries)
    .set({ captionOverride: text === post.caption ? null : text })
    .where(eq(deliveries.id, deliveryId));
  await logEvent(db, deliveryId, "edited", { text });
}

export type RemovalReport = { deliveryId: string; channel: string; ok: boolean; message: string };

/**
 * Removal: takes each Delivery down from its network and records its own result.
 * A Delivery that never went live is simply cancelled.
 */
export async function removeDeliveries(
  db: Db,
  deliveryIds: string[],
  options: { desktop?: DesktopNotifier } = {},
): Promise<RemovalReport[]> {
  return Promise.all(deliveryIds.map((id) => removeOne(db, id, options)));
}

async function removeOne(db: Db, deliveryId: string, options: { desktop?: DesktopNotifier }): Promise<RemovalReport> {
  const { delivery, channel, post } = await loadDelivery(db, deliveryId);
  const label = `${channel.displayName} on ${networkName(channel.network)}`;
  const report = (ok: boolean, message: string): RemovalReport => ({ deliveryId, channel: label, ok, message });

  if (delivery.status === "removed") return report(true, "Already removed.");
  if (delivery.status === "publishing" || delivery.status === "needs_attention") {
    return report(false, "It is being published right now. Try again once it has finished.");
  }
  if (delivery.status === "scheduled" || delivery.status === "failed") {
    // Nothing is live, so nothing to take down: cancel it, unless a worker just picked it up.
    const [cancelled] = await db
      .update(deliveries)
      .set({
        status: "removed",
        removedAt: new Date(),
        removalResult: { ok: true, note: "Cancelled before it went live.", at: new Date().toISOString() },
      })
      .where(and(eq(deliveries.id, deliveryId), inArray(deliveries.status, ["scheduled", "failed"]), isNull(deliveries.inFlightSince)))
      .returning({ id: deliveries.id });
    if (!cancelled) return report(false, "It is being published right now. Try again once it has finished.");
    await logEvent(db, deliveryId, "cancelled");
    return report(true, "Cancelled before it went live.");
  }

  let connector: Connector;
  let access: Awaited<ReturnType<typeof accessFor>>;
  try {
    connector = connectorFor(channel);
    access = await accessFor(channel, db);
  } catch (error) {
    return report(false, error instanceof Error ? error.message : "Not available.");
  }
  if (!(await lock(db, deliveryId))) return report(false, "Another change is running on it. Try again in a moment.");

  try {
    const outcome = await connector.remove(access, {
      externalPostId: delivery.externalPostId!,
      state: delivery.networkState,
    });
    const note = outcome.note ?? connector.baseCapabilities.removal.note;
    const result: RemovalResult = { ok: true, permanent: outcome.permanent, note, at: new Date().toISOString() };
    await db
      .update(deliveries)
      .set({ status: "removed", removedAt: new Date(), removalResult: result, inFlightSince: null })
      .where(eq(deliveries.id, deliveryId));
    await logEvent(db, deliveryId, "removed", { permanent: outcome.permanent });
    return report(true, note);
  } catch (error) {
    if (error instanceof ConnectorError && error.notFound) {
      // Deleted on the network already, such as by hand: there is nothing left to take down.
      const note = `It was already gone from ${networkName(channel.network)}, so it is marked removed.`;
      await db
        .update(deliveries)
        .set({
          status: "removed",
          removedAt: new Date(),
          removalResult: { ok: true, permanent: true, note, at: new Date().toISOString() },
          inFlightSince: null,
        })
        .where(eq(deliveries.id, deliveryId));
      await logEvent(db, deliveryId, "removed", { permanent: true, alreadyGone: true });
      return report(true, note);
    }
    if (error instanceof ConnectorError && error.kind === "auth") {
      await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, channel.id));
    }
    const message = networkError(error, channel);
    await db
      .update(deliveries)
      .set({ removalResult: { ok: false, error: message, at: new Date().toISOString() }, inFlightSince: null })
      .where(eq(deliveries.id, deliveryId));
    await logEvent(db, deliveryId, "removal_failed", { error: message });
    await raiseAlert(
      db,
      { kind: "removal_failed", title: `Not removed from ${label}`, body: message, deliveryId, link: `/posts/${post.id}` },
      options.desktop,
    );
    return report(false, message);
  }
}

/**
 * Replace: removes a live Delivery and publishes a new one in its place, with new text and,
 * optionally, new media (`mediaIds`, in order; null keeps the current media).
 * Used when the media changes or the network cannot Edit. Likes and comments on the old one are lost.
 */
export async function replaceDelivery(
  db: Db,
  deliveryId: string,
  rawText: string,
  options: { mediaIds?: string[] | null; now?: Date } = {},
): Promise<string> {
  const { delivery, channel } = await loadDelivery(db, deliveryId);
  const text = rawText.trimEnd();
  const mediaIds = options.mediaIds ?? null;
  if (delivery.status !== "published") throw new UserError("Only a live Delivery can be replaced.");
  if (mediaIds && new Set(mediaIds).size !== mediaIds.length) throw new UserError("A file was chosen twice.");
  const connector = connectorFor(channel);
  const capabilities = await connector.capabilities(await accessFor(channel, db));
  const problems = await problemsFor(db, delivery, channel, text, capabilities, mediaIds);
  if (problems.length > 0) throw new UserError(problems.join(" "));

  const [removal] = await removeDeliveries(db, [deliveryId]);
  if (!removal.ok) throw new UserError(`The old post could not be removed, so nothing was replaced. ${removal.message}`);

  return db.transaction(async (tx) => {
    await tx.update(deliveries).set({ superseded: true }).where(eq(deliveries.id, deliveryId));
    const [replacement] = await tx
      .insert(deliveries)
      .values({
        postId: delivery.postId,
        channelId: delivery.channelId,
        captionOverride: text,
        fields: delivery.fields,
        approvedCrops: delivery.approvedCrops,
        approvedTrims: delivery.approvedTrims,
        mediaOverride: mediaIds ?? delivery.mediaOverride,
        scheduledFor: options.now ?? new Date(),
        replacesDeliveryId: delivery.id,
      })
      .returning();
    await tx.insert(deliveryEvents).values({
      deliveryId: replacement.id,
      type: "replaces",
      detail: { previous: delivery.id, mediaChanged: Boolean(mediaIds) },
    });
    return replacement.id;
  });
}

export type PostDetail = Awaited<ReturnType<typeof loadPostDetail>>;

/** Everything the Post detail screen shows. */
export async function loadPostDetail(db: Db, postId: string) {
  const [row] = await db
    .select({ post: posts, brandName: brands.name })
    .from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(eq(posts.id, postId));
  if (!row) return null;

  const [deliveryRows, mediaRows] = await Promise.all([
    db
      .select({ delivery: deliveries, channel: channels })
      .from(deliveries)
      .innerJoin(channels, eq(channels.id, deliveries.channelId))
      .where(eq(deliveries.postId, postId))
      .orderBy(asc(channels.network), asc(channels.displayName), desc(deliveries.createdAt)),
    db
      .select({ asset: mediaAssets })
      .from(postMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.assetId))
      .where(eq(postMedia.postId, postId))
      .orderBy(asc(postMedia.position)),
  ]);

  const current = deliveryRows.filter(({ delivery }) => !delivery.superseded);
  // Media of Deliveries whose Replace changed it.
  const overrideIds = [...new Set(current.flatMap(({ delivery }) => delivery.mediaOverride ?? []))];
  const overrideAssets =
    overrideIds.length > 0 ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, overrideIds)) : [];
  // Each Channel's own rules (X with Premium can Edit; without, it cannot).
  const capabilityByChannel = new Map(
    await Promise.all(current.map(async ({ channel }) => [channel.id, await channelCapabilities(channel)] as const)),
  );
  return {
    post: row.post,
    brandName: row.brandName,
    status: computePostStatus(current.map(({ delivery }) => delivery.status)),
    media: mediaRows.map(({ asset }) => asset),
    deliveries: current.map(({ delivery, channel }) => {
      const connector = getConnector(channel.network);
      const rules = capabilityByChannel.get(channel.id) ?? null;
      return {
        ...delivery,
        text: delivery.captionOverride ?? row.post.caption,
        channelName: channel.displayName,
        channelHandle: channel.handle,
        network: channel.network,
        networkName: networkName(channel.network),
        canEdit: Boolean(rules?.edit.text && connector?.editText),
        editNote: rules?.edit.note ?? "",
        removalNote: rules?.removal.note ?? "",
        removalPermanent: rules?.removal.permanent ?? true,
        captionRules: rules?.caption ?? null,
        replaced: deliveryRows.some(({ delivery: older }) => older.id === delivery.replacesDeliveryId),
        ownMedia: delivery.mediaOverride
          ? delivery.mediaOverride.flatMap((id) => overrideAssets.filter((asset) => asset.id === id))
          : null,
      };
    }),
  };
}
