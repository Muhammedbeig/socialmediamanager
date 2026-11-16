import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeNetwork } from "@/connectors/fake";
import type { Db } from "@/db/client";
import { deliveries, mediaAssets, notifications } from "@/db/schema";
import { editDelivery, loadPostDetail, removeDeliveries, replaceDelivery } from "@/deliveries/manage";
import { UserError } from "@/domain/errors";
import { runDelivery } from "@/jobs/run-delivery";
import { openTestDb, resetTestDb } from "../helpers/db";
import { deliveryTo, fakeChannel } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
const T0 = new Date("2026-11-11T09:00:00Z");
const deps = { now: () => T0, mediaHost: null };

beforeAll(async () => {
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
});
afterAll(() => close?.());
beforeEach(async () => {
  await resetTestDb(db);
  fakeNetwork.reset();
});

const row = async (id: string) => (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0];

async function livePost(caption = "Original", externalId = "fake-1") {
  const setup = await fakeChannel(db, externalId);
  const { post, delivery } = await deliveryTo(db, setup, { caption, scheduledFor: T0 });
  expect(await runDelivery(db, delivery.id, deps)).toBe("published");
  return { setup, post, delivery: await row(delivery.id) };
}

describe("Edit", () => {
  it("changes the text in place on the network and keeps it on the Delivery", async () => {
    const { delivery } = await livePost();
    await editDelivery(db, delivery.id, "Fixed a typo");
    expect(fakeNetwork.posts.get(delivery.externalPostId!)!.caption).toBe("Fixed a typo");
    expect((await row(delivery.id)).captionOverride).toBe("Fixed a typo");
  });

  it("refuses text the network would not take", async () => {
    const { delivery } = await livePost();
    await expect(editDelivery(db, delivery.id, "x".repeat(300))).rejects.toThrow(/280 characters/);
  });

  it("refuses a Delivery that is not live", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: new Date("2030-01-01") });
    await expect(editDelivery(db, delivery.id, "New")).rejects.toThrow(UserError);
  });

  it("reports a failed edit and leaves the Delivery live", async () => {
    const { delivery } = await livePost();
    fakeNetwork.failNext("edit", "rejected", "Edit window closed");
    await expect(editDelivery(db, delivery.id, "New")).rejects.toThrow(/Edit window closed/);
    expect(await row(delivery.id)).toMatchObject({ status: "published", inFlightSince: null });
  });
});

describe("Removal", () => {
  it("takes a live Delivery down and records the network's result", async () => {
    const { delivery } = await livePost();
    const [report] = await removeDeliveries(db, [delivery.id]);
    expect(report.ok).toBe(true);
    expect(fakeNetwork.posts.size).toBe(0);
    const after = await row(delivery.id);
    expect(after.status).toBe("removed");
    expect(after.removalResult).toMatchObject({ ok: true, permanent: true });
  });

  it("records a failed Removal on that Delivery only, keeps it live, and raises an alert", async () => {
    const { delivery } = await livePost();
    fakeNetwork.failNext("remove", "retryable", "Try later");
    const [report] = await removeDeliveries(db, [delivery.id]);
    expect(report).toMatchObject({ ok: false });
    expect(report.message).toContain("Try later");
    const after = await row(delivery.id);
    expect(after.status).toBe("published");
    expect(after.removalResult).toMatchObject({ ok: false });
    expect((await db.select().from(notifications))[0].kind).toBe("removal_failed");
  });

  it("cancels a Delivery that has not gone live, without calling the network", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: new Date("2030-01-01") });
    const [report] = await removeDeliveries(db, [delivery.id]);
    expect(report).toMatchObject({ ok: true, message: "Cancelled before it went live." });
    expect((await row(delivery.id)).status).toBe("removed");
    // A cancelled Delivery is never picked up later.
    expect(await runDelivery(db, delivery.id, { now: () => new Date("2030-01-02"), mediaHost: null })).toBe("skipped");
  });

  it("does not remove a Delivery that is being published right now", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    await db.update(deliveries).set({ status: "publishing", inFlightSince: T0 }).where(eq(deliveries.id, delivery.id));
    const [report] = await removeDeliveries(db, [delivery.id]);
    expect(report.ok).toBe(false);
  });

  it("removes each Delivery on its own when removing from several Channels", async () => {
    const first = await livePost("One");
    const second = await livePost("Two", "fake-2");
    fakeNetwork.failNext("remove", "rejected", "Nope");
    const reports = await removeDeliveries(db, [first.delivery.id, second.delivery.id]);
    expect(reports.filter((r) => r.ok)).toHaveLength(1);
    expect(reports.filter((r) => !r.ok)).toHaveLength(1);
  });
});

describe("Replace", () => {
  it("removes the live Delivery and queues a new one with the new text", async () => {
    const { post, delivery } = await livePost();
    const replacementId = await replaceDelivery(db, delivery.id, "Brand new text", { now: T0 });

    const old = await row(delivery.id);
    expect(old).toMatchObject({ status: "removed", superseded: true });
    const replacement = await row(replacementId);
    expect(replacement).toMatchObject({ status: "scheduled", captionOverride: "Brand new text", replacesDeliveryId: delivery.id });

    expect(await runDelivery(db, replacementId, deps)).toBe("published");
    expect([...fakeNetwork.posts.values()].map((p) => p.caption)).toEqual(["Brand new text"]);

    const detail = await loadPostDetail(db, post.id);
    expect(detail!.deliveries).toHaveLength(1);
    expect(detail!.deliveries[0]).toMatchObject({ id: replacementId, replaced: true });
    expect(detail!.status).toBe("published");
  });

  it("can change the media, for that Channel only", async () => {
    const { post, delivery } = await livePost();
    const [asset] = await db
      .insert(mediaAssets)
      .values({
        kind: "image",
        originalName: "new.jpg",
        path: "originals/new.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1000,
        width: 1000,
        height: 1000,
        sha256: "new",
      })
      .returning();

    const replacementId = await replaceDelivery(db, delivery.id, "New photo", { mediaIds: [asset.id], now: T0 });
    expect((await row(replacementId)).mediaOverride).toEqual([asset.id]);
    const detail = await loadPostDetail(db, post.id);
    expect(detail!.deliveries[0].ownMedia?.map((m) => m.id)).toEqual([asset.id]);
    // The Post itself keeps its own (here: no) media.
    expect(detail!.media).toEqual([]);
  });

  it("refuses new media that would need a crop it cannot approve", async () => {
    const { delivery } = await livePost();
    const [tall] = await db
      .insert(mediaAssets)
      .values({
        kind: "image",
        originalName: "tall.jpg",
        path: "originals/tall.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1000,
        width: 1000,
        height: 3000,
        sha256: "tall",
      })
      .returning();
    await expect(replaceDelivery(db, delivery.id, "x", { mediaIds: [tall.id] })).rejects.toThrow(/needs a crop.*Duplicate/);
    expect((await row(delivery.id)).status).toBe("published");
  });

  it("replaces nothing when the old post cannot be removed", async () => {
    const { post, delivery } = await livePost();
    fakeNetwork.failNext("remove", "rejected", "Nope");
    await expect(replaceDelivery(db, delivery.id, "New")).rejects.toThrow(/nothing was replaced/);
    const current = await db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.postId, post.id), eq(deliveries.superseded, false)));
    expect(current).toHaveLength(1);
    expect(current[0].status).toBe("published");
  });
});
