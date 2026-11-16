import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { needsReconnect } from "@/channels/connect";
import { getConnector, networkName } from "@/connectors/registry";
import { type ChannelAccess, type Connector, ConnectorError, type ConnectorErrorKind, type PreparedMedia } from "@/connectors/types";
import type { Db } from "@/db/client";
import { type Network, channels, deliveries, deliveryEvents, mediaAssets, postMedia, posts } from "@/db/schema";
import { canPublish, checkPost, postFormat } from "@/domain/checks";
import { prepareImage, prepareVideo } from "@/media/convert";
import type { MediaHost } from "@/media/host";
import { type DesktopNotifier, raiseAlert } from "@/notify";
import { decryptToken } from "@/secrets/tokens";
import { setSetting } from "@/settings/values";
import { attentionHooks } from "./attention";

// Runs one Delivery: one Post going to one Channel. Each Delivery succeeds, fails and retries on
// its own. A Delivery that is live, removed, or whose outcome is unknown is never sent again.

/** Automatic retries after the first attempt: about 15 minutes in all. */
export const RETRY_DELAYS_MS = [2, 4, 8].map((minutes) => minutes * 60_000);
/**
 * A call still marked in flight after this long means the worker died mid-call. Longer than a
 * browser Delivery can wait for the Member to clear a login check (one hour).
 */
export const STALE_IN_FLIGHT_MS = 75 * 60_000;

export type RunDeps = {
  now: () => Date;
  /** Null when Cloudflare R2 is not set up. */
  mediaHost: MediaHost | null;
  connectorFor?: (network: Network) => Connector | undefined;
  desktop?: DesktopNotifier;
};

export type RunOutcome = "published" | "retry_scheduled" | "failed" | "skipped";

type Failure = { kind: ConnectorErrorKind; message: string };

function describe(error: unknown): Failure {
  if (error instanceof ConnectorError) return { kind: error.kind, message: error.message };
  // Media conversion and other local problems will not fix themselves on a retry.
  return { kind: "rejected", message: error instanceof Error ? error.message : "Unknown error" };
}

async function logEvent(db: Db, deliveryId: string, type: string, detail: Record<string, unknown> = {}) {
  await db.insert(deliveryEvents).values({ deliveryId, type, detail });
}

/** The media a Delivery sends: its own after a Replace that changed the media, else the Post's. */
export async function deliveryMedia(db: Db, postId: string, mediaOverride: string[] | null) {
  if (mediaOverride) {
    if (mediaOverride.length === 0) return [];
    const rows = await db.select().from(mediaAssets).where(inArray(mediaAssets.id, mediaOverride));
    return mediaOverride.map((id) => rows.find((row) => row.id === id)).filter((row) => row !== undefined);
  }
  const rows = await db
    .select({ asset: mediaAssets })
    .from(postMedia)
    .innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.assetId))
    .where(eq(postMedia.postId, postId))
    .orderBy(asc(postMedia.position));
  return rows.map((row) => row.asset);
}

/** The Deliveries that are due now: scheduled ones whose time has come, and retries whose wait is over. */
export function dueCondition(now: Date) {
  return and(
    eq(deliveries.superseded, false),
    isNull(deliveries.inFlightSince),
    or(
      and(eq(deliveries.status, "scheduled"), lte(deliveries.scheduledFor, now)),
      and(eq(deliveries.status, "publishing"), lte(deliveries.nextAttemptAt, now)),
    ),
  );
}

export async function runDelivery(db: Db, deliveryId: string, deps: RunDeps): Promise<RunOutcome> {
  const now = deps.now();
  const connectorFor = deps.connectorFor ?? getConnector;

  // Claim the Delivery. Only one worker can win, and only while it is due.
  const [claimed] = await db
    .update(deliveries)
    .set({
      status: "publishing",
      attempts: sql`${deliveries.attempts} + 1`,
      inFlightSince: now,
      nextAttemptAt: null,
      startedAt: sql`coalesce(${deliveries.startedAt}, ${now})`,
    })
    .where(and(eq(deliveries.id, deliveryId), dueCondition(now)))
    .returning();

  if (!claimed) {
    const [row] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    if (row?.status === "publishing" && row.inFlightSince && now.getTime() - row.inFlightSince.getTime() > STALE_IN_FLIGHT_MS) {
      await db
        .update(deliveries)
        .set({
          status: "failed",
          inFlightSince: null,
          lastError:
            "The app stopped while sending this Delivery, so it may or may not be live. Check the Channel before you Retry.",
        })
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.inFlightSince, row.inFlightSince)));
      await logEvent(db, deliveryId, "outcome_unknown", { reason: "worker stopped mid-call" });
      return "failed";
    }
    return "skipped";
  }

  const [context] = await db
    .select({ post: posts, channel: channels })
    .from(posts)
    .innerJoin(channels, eq(channels.id, claimed.channelId))
    .where(eq(posts.id, claimed.postId));
  const { post, channel } = context;
  const label = `${channel.displayName} on ${networkName(channel.network)}`;
  const hosted: string[] = [];

  const cleanUp = async () => {
    if (!deps.mediaHost) return;
    await Promise.all(
      hosted.map((key) =>
        deps.mediaHost!.remove(key).catch((error) => console.error(`Could not remove ${key} from R2`, error)),
      ),
    );
  };

  try {
    const connector = connectorFor(channel.network);
    if (!connector) throw new ConnectorError("rejected", `Publishing to ${networkName(channel.network)} is not available.`);
    // Browser Channels log in through their own browser profile, so they carry no token.
    const browser = connector.kind === "browser";
    if (needsReconnect(channel, now) || (!browser && !channel.tokenEncrypted)) {
      throw new ConnectorError("auth", `${label} needs reconnecting.`);
    }
    const access: ChannelAccess = {
      channelId: channel.id,
      externalId: channel.externalId,
      handle: channel.handle,
      accessToken: channel.tokenEncrypted ? await decryptToken(channel.tokenEncrypted) : "",
      settings: channel.settings,
      screenshotName: `delivery-${deliveryId}`,
      attention: browser
        ? attentionHooks(db, { channelId: channel.id, label, deliveryId, desktop: deps.desktop })
        : undefined,
    };
    if (browser) await setSetting(db, `browser_last_start:${channel.network}`, now.toISOString());
    const capabilities = await connector.capabilities(access);

    const assets = await deliveryMedia(db, post.id, claimed.mediaOverride);
    const caption = claimed.captionOverride ?? post.caption;

    // The network's rules may have changed since the Post was saved: check again.
    const issues = checkPost(
      {
        caption,
        media: assets.map((asset) => ({
          assetId: asset.id,
          kind: asset.kind,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width,
          height: asset.height,
          durationMs: asset.durationMs,
        })),
        approvedCrops: claimed.approvedCrops,
        approvedTrims: claimed.approvedTrims,
        fields: claimed.fields,
      },
      capabilities,
      networkName(channel.network),
    );
    if (!canPublish(issues)) {
      const reasons = issues.filter((issue) => issue.kind !== "convert").map((issue) => issue.message);
      throw new ConnectorError("rejected", reasons.join(" "));
    }

    const media: PreparedMedia[] = [];
    for (const asset of assets) {
      const prepared =
        asset.kind === "image"
          ? await prepareImage(db, asset, capabilities.image!, claimed.approvedCrops[asset.id])
          : await prepareVideo(db, asset, capabilities.video!, claimed.approvedTrims[asset.id]);
      if (capabilities.fetchesMediaFromPublicUrl) {
        if (!deps.mediaHost) {
          throw new ConnectorError(
            "rejected",
            `${networkName(channel.network)} needs Cloudflare R2 to fetch media. Add the R2 settings to .env.local (docs/setup.md).`,
          );
        }
        const { key, url } = await deps.mediaHost.put(prepared.path, prepared.mimeType);
        hosted.push(key);
        prepared.publicUrl = url;
      }
      media.push(prepared);
    }

    const result = await connector.publish(access, {
      format: postFormat(assets)!,
      caption,
      media,
      fields: claimed.fields,
      state: claimed.networkState,
      saveState: async (state) => {
        await db.update(deliveries).set({ networkState: state }).where(eq(deliveries.id, deliveryId));
      },
    });

    const publishedAt = deps.now();
    await db
      .update(deliveries)
      .set({
        status: "published",
        publishedAt,
        externalPostId: result.externalPostId,
        liveUrl: result.liveUrl,
        inFlightSince: null,
        lastError: null,
      })
      .where(eq(deliveries.id, deliveryId));
    await logEvent(db, deliveryId, "published", { attempt: claimed.attempts, liveUrl: result.liveUrl });
    await cleanUp();
    return "published";
  } catch (error) {
    await cleanUp();
    const failure = describe(error);

    if (failure.kind === "auth") {
      await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, channel.id));
    }

    if (failure.kind === "retryable" && claimed.attempts <= RETRY_DELAYS_MS.length) {
      const nextAttemptAt = new Date(deps.now().getTime() + RETRY_DELAYS_MS[claimed.attempts - 1]);
      await db
        .update(deliveries)
        // Back to Publishing, in case the attempt had stopped at Needs attention.
        .set({ status: "publishing", inFlightSince: null, nextAttemptAt, lastError: failure.message })
        .where(eq(deliveries.id, deliveryId));
      await logEvent(db, deliveryId, "retry_scheduled", {
        attempt: claimed.attempts,
        error: failure.message,
        nextAttemptAt: nextAttemptAt.toISOString(),
      });
      return "retry_scheduled";
    }

    const message =
      failure.kind === "outcome_unknown"
        ? `${failure.message} It may or may not be live. Check the Channel before you Retry.`
        : failure.message;
    await db
      .update(deliveries)
      .set({ status: "failed", inFlightSince: null, nextAttemptAt: null, lastError: message })
      .where(eq(deliveries.id, deliveryId));
    await logEvent(db, deliveryId, "failed", { attempt: claimed.attempts, kind: failure.kind, error: message });
    await raiseAlert(
      db,
      {
        kind: "delivery_failed",
        title: `Not published to ${label}`,
        body: message,
        deliveryId,
        link: `/posts/${post.id}`,
      },
      deps.desktop,
    );
    return "failed";
  }
}

/** Puts a Failed Delivery back in line to publish now. */
export async function retryDelivery(db: Db, deliveryId: string): Promise<boolean> {
  const [row] = await db
    .update(deliveries)
    .set({ status: "scheduled", attempts: 0, inFlightSince: null, nextAttemptAt: null, lastError: null })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "failed"), eq(deliveries.superseded, false)))
    .returning({ id: deliveries.id });
  if (row) await logEvent(db, deliveryId, "manual_retry");
  return Boolean(row);
}
