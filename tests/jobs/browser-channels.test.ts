import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addBrowserChannel, requestLogin, setPremium, setShowWindow } from "@/channels/browser";
import { fakeConnector, fakeNetwork } from "@/connectors/fake";
import { channelCapabilities } from "@/connectors/registry";
import type { Connector } from "@/connectors/types";
import type { Db } from "@/db/client";
import { brands, channels, deliveries, notifications, posts } from "@/db/schema";
import { seedOwner } from "@/db/seed";
import { dispatchDue } from "@/jobs/publisher";
import { runDelivery } from "@/jobs/run-delivery";
import { requestBringForward, setSetting } from "@/settings/values";
import { openTestDb, resetTestDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
const T0 = new Date("2026-11-16T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

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

/** A Brand with browser Channels on the given networks (connected, no token). */
async function setup(networks: ("tiktok" | "x" | "facebook")[]) {
  const owner = await seedOwner(db);
  const [brand] = await db.insert(brands).values({ name: "Acme" }).returning();
  const rows = [];
  for (const [index, network] of networks.entries()) {
    const browser = network !== "facebook";
    const [channel] = await db
      .insert(channels)
      .values({
        brandId: brand.id,
        network,
        connectorKind: browser ? "browser" : "api",
        displayName: `${network} ${index}`,
        externalId: `${network}-${index}`,
        tokenEncrypted: browser ? null : "v1.x.x.x",
      })
      .returning();
    rows.push(channel);
  }
  const [post] = await db.insert(posts).values({ brandId: brand.id, caption: "Hi", createdBy: owner.id }).returning();
  return { brand, post, channels: rows };
}

async function deliver(postId: string, channelId: string, scheduledFor = T0) {
  const [row] = await db.insert(deliveries).values({ postId, channelId, scheduledFor }).returning();
  return row;
}

const read = async (id: string) => (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0];

describe("pacing for browser networks", () => {
  it("sends one Delivery per browser network at a time, and API ones all at once", async () => {
    const { post, channels: [tiktokA, tiktokB, x, facebook] } = await setup(["tiktok", "tiktok", "x", "facebook"]);
    // Two posts so Facebook has two Deliveries too.
    const [post2] = await db.insert(posts).values({ brandId: post.brandId, caption: "Two", createdBy: post.createdBy }).returning();
    const a = await deliver(post.id, tiktokA.id);
    const b = await deliver(post.id, tiktokB.id, minutes(1));
    const c = await deliver(post.id, x.id);
    const f1 = await deliver(post.id, facebook.id);
    const f2 = await deliver(post2.id, facebook.id);

    const sent: string[] = [];
    await dispatchDue(db, async (id) => sent.push(id), minutes(2));
    expect(sent.sort()).toEqual([a.id, c.id, f1.id, f2.id].sort());
    expect(sent).not.toContain(b.id);
  });

  it("waits for the running one, then for the spacing, before the next on that network", async () => {
    const { post, channels: [one, two] } = await setup(["tiktok", "tiktok"]);
    const first = await deliver(post.id, one.id);
    const second = await deliver(post.id, two.id);

    // The first is running.
    await db.update(deliveries).set({ status: "publishing", inFlightSince: T0 }).where(eq(deliveries.id, first.id));
    await setSetting(db, "browser_last_start:tiktok", T0.toISOString());
    let sent: string[] = [];
    await dispatchDue(db, async (id) => sent.push(id), minutes(1));
    expect(sent).toEqual([]);

    // Finished, but the 3-minute gap has not passed.
    await db.update(deliveries).set({ status: "published", inFlightSince: null }).where(eq(deliveries.id, first.id));
    sent = [];
    await dispatchDue(db, async (id) => sent.push(id), minutes(2));
    expect(sent).toEqual([]);

    sent = [];
    await dispatchDue(db, async (id) => sent.push(id), minutes(3));
    expect(sent).toEqual([second.id]);
  });

  it("follows the spacing chosen in Settings", async () => {
    const { post, channels: [one] } = await setup(["x"]);
    const delivery = await deliver(post.id, one.id);
    await setSetting(db, "browser_spacing_minutes", 10);
    await setSetting(db, "browser_last_start:x", T0.toISOString());
    const sent: string[] = [];
    await dispatchDue(db, async (id) => sent.push(id), minutes(5));
    expect(sent).toEqual([]);
    await dispatchDue(db, async (id) => sent.push(id), minutes(10));
    expect(sent).toEqual([delivery.id]);
  });
});

describe("Needs attention", () => {
  /** A browser Connector that meets a login check, waits for the Member, then posts. */
  function checkingConnector(options: { failAfterCheck?: boolean } = {}): Connector {
    return {
      ...fakeConnector,
      network: "tiktok",
      kind: "browser",
      async publish(access, input) {
        await access.attention!.needed("Log in to this account in its browser window.");
        expect(await read(currentId)).toMatchObject({ status: "needs_attention", lastError: "Log in to this account in its browser window." });
        expect(await access.attention!.bringForwardRequested()).toBe(true);
        expect(await access.attention!.bringForwardRequested()).toBe(false);
        await access.attention!.resolved();
        expect((await read(currentId)).status).toBe("publishing");
        if (options.failAfterCheck) {
          const { ConnectorError } = await import("@/connectors/types");
          throw new ConnectorError("retryable", "Upload stalled");
        }
        return fakeConnector.publish(access, input);
      },
    };
  }
  let currentId = "";

  it("pauses the Delivery for the Member, raises an alert, then carries on", async () => {
    const { post, channels: [channel] } = await setup(["tiktok"]);
    const delivery = await deliver(post.id, channel.id);
    currentId = delivery.id;
    await requestBringForward(db, channel.id);

    const outcome = await runDelivery(db, delivery.id, { now: () => T0, mediaHost: null, connectorFor: () => checkingConnector() });
    expect(outcome).toBe("published");
    const alerts = await db.select().from(notifications);
    expect(alerts.map((a) => a.kind)).toEqual(["needs_attention"]);
  });

  it("goes back to Publishing for its retry, never stuck at Needs attention", async () => {
    const { post, channels: [channel] } = await setup(["tiktok"]);
    const delivery = await deliver(post.id, channel.id);
    currentId = delivery.id;
    await requestBringForward(db, channel.id);
    const outcome = await runDelivery(db, delivery.id, {
      now: () => T0,
      mediaHost: null,
      connectorFor: () => checkingConnector({ failAfterCheck: true }),
    });
    expect(outcome).toBe("retry_scheduled");
    expect((await read(delivery.id)).status).toBe("publishing");
  });

  it("does not need a token for a browser Channel", async () => {
    const { post, channels: [channel] } = await setup(["x"]);
    const delivery = await deliver(post.id, channel.id);
    const browserFake: Connector = { ...fakeConnector, network: "x", kind: "browser" };
    expect(await runDelivery(db, delivery.id, { now: () => T0, mediaHost: null, connectorFor: () => browserFake })).toBe("published");
  });
});

describe("browser Channels", () => {
  it("adds an account waiting to log in, with a tidy handle", async () => {
    const { brand } = await setup([]);
    const channel = await addBrowserChannel(db, { brandId: brand.id, network: "tiktok", displayName: " Acme  on TikTok ", handle: "@acme.shop" });
    expect(channel).toMatchObject({ network: "tiktok", connectorKind: "browser", displayName: "Acme on TikTok", handle: "acme.shop", status: "reconnect_needed" });
    expect(typeof channel.settings.loginRequestedAt).toBe("string");
  });

  it("refuses API networks, which connect through their login", async () => {
    const { brand } = await setup([]);
    await expect(addBrowserChannel(db, { brandId: brand.id, network: "facebook", displayName: "x", handle: "" })).rejects.toThrow();
  });

  it("asks for a fresh login and clears the last login error", async () => {
    const { brand } = await setup([]);
    const channel = await addBrowserChannel(db, { brandId: brand.id, network: "pinterest", displayName: "Pins", handle: "" });
    await db.update(channels).set({ settings: { loginError: "No login within 15 minutes." } }).where(eq(channels.id, channel.id));
    const again = await requestLogin(db, channel.id);
    expect(again.settings.loginError).toBeUndefined();
    expect(typeof again.settings.loginRequestedAt).toBe("string");
  });

  it("gives an X Channel with Premium long posts and Edit", async () => {
    const { brand } = await setup([]);
    const channel = await addBrowserChannel(db, { brandId: brand.id, network: "x", displayName: "Acme on X", handle: "acme" });
    expect((await channelCapabilities(channel))!.caption.maxChars).toBe(280);
    const premium = await setPremium(db, channel.id, true);
    const rules = (await channelCapabilities(premium))!;
    expect(rules.caption.maxChars).toBe(25_000);
    expect(rules.edit.text).toBe(true);
  });

  it("keeps the posting window minimized until Show window is chosen, and only for browser Channels", async () => {
    const { brand } = await setup([]);
    const channel = await addBrowserChannel(db, { brandId: brand.id, network: "tiktok", displayName: "Acme", handle: "" });
    expect(channel.settings.showWindow).toBeUndefined();
    const shown = await setShowWindow(db, channel.id, true);
    expect(shown.settings.showWindow).toBe(true);
    expect(typeof shown.settings.loginRequestedAt).toBe("string");
    expect((await setShowWindow(db, channel.id, false)).settings.showWindow).toBe(false);
    const [api] = await db
      .insert(channels)
      .values({ brandId: brand.id, network: "facebook", connectorKind: "api", displayName: "Page", externalId: "p1" })
      .returning();
    await expect(setShowWindow(db, api.id, true)).rejects.toThrow(/no longer exists/);
  });
});
