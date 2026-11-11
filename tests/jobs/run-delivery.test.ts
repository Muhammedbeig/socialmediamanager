import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeConnector, fakeNetwork } from "@/connectors/fake";
import type { Connector } from "@/connectors/types";
import type { Db } from "@/db/client";
import { channels, deliveries, deliveryEvents, notifications, postMedia } from "@/db/schema";
import { dispatchDue } from "@/jobs/publisher";
import { RETRY_DELAYS_MS, type RunDeps, retryDelivery, runDelivery } from "@/jobs/run-delivery";
import { ffmpeg } from "@/media/ffmpeg";
import type { MediaHost } from "@/media/host";
import { saveUpload } from "@/media/library";
import { probeFile } from "@/media/probe";
import { openTestDb, resetTestDb } from "../helpers/db";
import { deliveryTo, fakeChannel } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let dir: string;
let clock: Date;
const T0 = new Date("2026-11-11T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const deps = (extra: Partial<RunDeps> = {}): RunDeps => ({ now: () => clock, mediaHost: null, ...extra });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "social-publisher-run-"));
  process.env.DATA_DIR = path.join(dir, "data");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc=size=800x800:rate=1", "-frames:v", "1", path.join(dir, "square.png")]);
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
});
afterAll(async () => {
  await close?.();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetTestDb(db);
  fakeNetwork.reset();
  clock = T0;
});

const row = async (id: string) => (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0];

describe("runDelivery", () => {
  it("publishes a due Delivery and records the scheduled and actual times", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { caption: "Fresh stock", scheduledFor: T0 });
    clock = minutes(152); // The laptop was asleep: due 9:00, sent 11:32.

    expect(await runDelivery(db, delivery.id, deps())).toBe("published");

    const after = await row(delivery.id);
    expect(after).toMatchObject({ status: "published", attempts: 1, inFlightSince: null, lastError: null });
    expect(after.scheduledFor).toEqual(T0);
    expect(after.startedAt).toEqual(minutes(152));
    expect(after.publishedAt).toEqual(minutes(152));
    expect(after.liveUrl).toBe(`https://fake.example/posts/${after.externalPostId}`);
    expect([...fakeNetwork.posts.values()].map((p) => p.caption)).toEqual(["Fresh stock"]);
  });

  it("uses the Channel's own caption when there is one", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0, captionOverride: "Just for this one" });
    await runDelivery(db, delivery.id, deps());
    expect([...fakeNetwork.posts.values()][0].caption).toBe("Just for this one");
  });

  it("does nothing before the Delivery is due", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: minutes(30) });
    expect(await runDelivery(db, delivery.id, deps())).toBe("skipped");
    expect((await row(delivery.id)).status).toBe("scheduled");
  });

  it("never sends a live Delivery twice, even when two jobs race", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    const outcomes = await Promise.all([runDelivery(db, delivery.id, deps()), runDelivery(db, delivery.id, deps())]);
    expect(outcomes.sort()).toEqual(["published", "skipped"]);
    expect(await runDelivery(db, delivery.id, deps())).toBe("skipped");
    expect(fakeNetwork.posts.size).toBe(1);
  });

  it("retries 3 times at about 2, 4 and 8 minutes, then fails and raises an alert", async () => {
    const setup = await fakeChannel(db);
    const { post, delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    for (let i = 0; i < 4; i++) fakeNetwork.failNext("publish", "retryable", "Service unavailable");

    expect(await runDelivery(db, delivery.id, deps())).toBe("retry_scheduled");
    let after = await row(delivery.id);
    expect(after).toMatchObject({ status: "publishing", attempts: 1, inFlightSince: null, lastError: "Service unavailable" });
    expect(after.nextAttemptAt).toEqual(minutes(2));

    clock = minutes(1);
    expect(await runDelivery(db, delivery.id, deps())).toBe("skipped");

    clock = minutes(2);
    expect(await runDelivery(db, delivery.id, deps())).toBe("retry_scheduled");
    expect((await row(delivery.id)).nextAttemptAt).toEqual(minutes(6));
    clock = minutes(6);
    expect(await runDelivery(db, delivery.id, deps())).toBe("retry_scheduled");
    expect((await row(delivery.id)).nextAttemptAt).toEqual(minutes(14));
    clock = minutes(14);
    expect(await runDelivery(db, delivery.id, deps())).toBe("failed");

    after = await row(delivery.id);
    expect(after).toMatchObject({ status: "failed", attempts: 4, nextAttemptAt: null });
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b) / 60_000).toBe(14);
    const alerts = await db.select().from(notifications);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "delivery_failed", deliveryId: delivery.id });
    expect(alerts[0].title).toContain("Fake fake-1");
    expect(post.id).toBeTruthy();
  });

  it("publishes on a later retry once the network recovers", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    fakeNetwork.failNext("publish", "retryable");
    await runDelivery(db, delivery.id, deps());
    clock = minutes(2);
    expect(await runDelivery(db, delivery.id, deps())).toBe("published");
    expect((await row(delivery.id)).startedAt).toEqual(T0);
  });

  it("fails at once, without retrying, when the network refuses the content", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    fakeNetwork.failNext("publish", "rejected", "Caption contains a banned link");
    expect(await runDelivery(db, delivery.id, deps())).toBe("failed");
    expect((await row(delivery.id)).lastError).toBe("Caption contains a banned link");
  });

  it("marks the Channel for reconnecting when the network refuses its token", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    fakeNetwork.failNext("publish", "auth", "Session has expired");
    expect(await runDelivery(db, delivery.id, deps())).toBe("failed");
    const [channel] = await db.select().from(channels).where(eq(channels.id, setup.channel.id));
    expect(channel.status).toBe("reconnect_needed");
  });

  it("never retries automatically when the request was sent but no answer came", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    fakeNetwork.failNext("publish", "outcome_unknown", "The network did not answer.");
    expect(await runDelivery(db, delivery.id, deps())).toBe("failed");
    expect((await row(delivery.id)).lastError).toMatch(/may or may not be live.*Check the Channel/);
  });

  it("fails a Delivery whose worker died mid-call, and leaves a fresh one alone", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    await db.update(deliveries).set({ status: "publishing", inFlightSince: T0 }).where(eq(deliveries.id, delivery.id));

    clock = minutes(5);
    expect(await runDelivery(db, delivery.id, deps())).toBe("skipped");
    clock = minutes(25);
    expect(await runDelivery(db, delivery.id, deps())).toBe("failed");
    expect((await row(delivery.id)).lastError).toMatch(/may or may not be live/);
    expect(fakeNetwork.posts.size).toBe(0);
  });

  it("fails a Delivery to a Channel that needs reconnecting, without calling the network", async () => {
    const setup = await fakeChannel(db);
    await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, setup.channel.id));
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    expect(await runDelivery(db, delivery.id, deps())).toBe("failed");
    expect((await row(delivery.id)).lastError).toMatch(/needs reconnecting/);
  });

  it("hosts media on a public URL for networks that fetch it, and removes it once live", async () => {
    const setup = await fakeChannel(db);
    const { post, delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    const asset = await saveUpload(db, { name: "square.png", body: createReadStream(path.join(dir, "square.png")) });
    await db.insert(postMedia).values({ postId: post.id, assetId: asset.id, position: 0 });

    const hosted = new Map<string, string>();
    const removed: string[] = [];
    const host: MediaHost = {
      async put(filePath, mimeType) {
        const key = `k${hosted.size}`;
        hosted.set(key, `${mimeType} ${(await probeFile(filePath)).mimeType}`);
        return { key, url: `https://media.example/${key}` };
      },
      async remove(key) {
        removed.push(key);
      },
    };
    const seen: (string | undefined)[] = [];
    const fetching: Connector = {
      ...fakeConnector,
      baseCapabilities: { ...fakeConnector.baseCapabilities, fetchesMediaFromPublicUrl: true },
      async capabilities() {
        return { ...fakeConnector.baseCapabilities, fetchesMediaFromPublicUrl: true };
      },
      async publish(access, input) {
        seen.push(...input.media.map((m) => m.publicUrl));
        return fakeConnector.publish(access, input);
      },
    };

    expect(await runDelivery(db, delivery.id, deps({ mediaHost: host, connectorFor: () => fetching }))).toBe("published");
    // The PNG was converted to JPEG before it was hosted.
    expect([...hosted.values()]).toEqual(["image/jpeg image/jpeg"]);
    expect(seen).toEqual(["https://media.example/k0"]);
    expect(removed).toEqual(["k0"]);
  });

  it("fails clearly when a network needs R2 and R2 is not set up", async () => {
    const setup = await fakeChannel(db);
    const { post, delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    const asset = await saveUpload(db, { name: "square.png", body: createReadStream(path.join(dir, "square.png")) });
    await db.insert(postMedia).values({ postId: post.id, assetId: asset.id, position: 0 });
    const fetching: Connector = {
      ...fakeConnector,
      async capabilities() {
        return { ...fakeConnector.baseCapabilities, fetchesMediaFromPublicUrl: true };
      },
    };
    expect(await runDelivery(db, delivery.id, deps({ connectorFor: () => fetching }))).toBe("failed");
    expect((await row(delivery.id)).lastError).toMatch(/Cloudflare R2/);
  });
});

describe("retryDelivery", () => {
  it("puts a Failed Delivery back in line with a fresh set of retries", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    fakeNetwork.failNext("publish", "rejected");
    await runDelivery(db, delivery.id, deps());

    expect(await retryDelivery(db, delivery.id)).toBe(true);
    expect(await row(delivery.id)).toMatchObject({ status: "scheduled", attempts: 0, lastError: null });
    clock = minutes(10);
    expect(await runDelivery(db, delivery.id, deps())).toBe("published");
    const events = await db.select().from(deliveryEvents).where(eq(deliveryEvents.deliveryId, delivery.id));
    expect(events.map((e) => e.type)).toEqual(["failed", "manual_retry", "published"]);
  });

  it("does not retry a Delivery that has not failed", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { scheduledFor: T0 });
    await runDelivery(db, delivery.id, deps());
    expect(await retryDelivery(db, delivery.id)).toBe(false);
  });
});

describe("dispatchDue", () => {
  it("sends due Deliveries and due retries, and nothing else", async () => {
    const setup = await fakeChannel(db);
    const due = await deliveryTo(db, setup, { scheduledFor: T0 });
    await deliveryTo(db, setup, { scheduledFor: minutes(60) });
    const retrying = await deliveryTo(db, setup, { scheduledFor: T0 });
    await db
      .update(deliveries)
      .set({ status: "publishing", nextAttemptAt: minutes(-1) })
      .where(eq(deliveries.id, retrying.delivery.id));
    const waiting = await deliveryTo(db, setup, { scheduledFor: T0 });
    await db
      .update(deliveries)
      .set({ status: "publishing", nextAttemptAt: minutes(5) })
      .where(eq(deliveries.id, waiting.delivery.id));
    const running = await deliveryTo(db, setup, { scheduledFor: T0 });
    await db
      .update(deliveries)
      .set({ status: "publishing", inFlightSince: T0 })
      .where(eq(deliveries.id, running.delivery.id));

    const sent: string[] = [];
    await dispatchDue(db, async (id) => sent.push(id), T0);
    expect(sent.sort()).toEqual([due.delivery.id, retrying.delivery.id].sort());
  });
});
