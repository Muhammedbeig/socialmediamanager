import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBrand, deleteBrand, listBrandsWithChannels, renameBrand } from "@/brands/service";
import { beginConnect, completeConnect, needsReconnect } from "@/channels/connect";
import { disconnectChannel, moveChannel } from "@/channels/service";
import { fakeConnector, fakeNetwork } from "@/connectors/fake";
import type { NetworkEntry } from "@/connectors/registry";
import type { Db } from "@/db/client";
import { channels, deliveries, posts } from "@/db/schema";
import { seedOwner } from "@/db/seed";
import { UserError } from "@/domain/errors";
import { decryptToken } from "@/secrets/tokens";
import { openTestDb, resetTestDb } from "../helpers/db";

const APP_URL = "https://localhost:3000";
const fakeEntry: NetworkEntry = {
  network: "fake",
  name: "Fake network",
  channelNoun: "profile",
  kind: "api",
  auth: fakeConnector.auth,
  requiredEnv: [],
};

let db: Db;
let close: () => Promise<void>;

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

async function connectFake(brandId: string) {
  return completeConnect(db, fakeEntry, { brandId, code: "fake-code", appUrl: APP_URL });
}

describe("Brands", () => {
  it("creates a Brand with a tidy name and refuses a duplicate", async () => {
    const brand = await createBrand(db, "  Acme   Foods ");
    expect(brand.name).toBe("Acme Foods");
    await expect(createBrand(db, "acme foods")).rejects.toThrow(UserError);
    await expect(createBrand(db, "   ")).rejects.toThrow(UserError);
  });

  it("renames a Brand, and lets it keep its own name", async () => {
    const brand = await createBrand(db, "Acme");
    await createBrand(db, "Globex");
    expect((await renameBrand(db, brand.id, "ACME")).name).toBe("ACME");
    await expect(renameBrand(db, brand.id, "Globex")).rejects.toThrow(UserError);
  });

  it("deletes an empty Brand but not one with Channels", async () => {
    const empty = await createBrand(db, "Empty");
    const used = await createBrand(db, "Used");
    await connectFake(used.id);
    await deleteBrand(db, empty.id);
    await expect(deleteBrand(db, used.id)).rejects.toThrow(/still has Channels/);
    expect((await listBrandsWithChannels(db)).map((b) => b.name)).toEqual(["Used"]);
  });
});

describe("connecting Channels", () => {
  it("sends the Member to the network's login with the callback address", () => {
    const { url, state } = beginConnect(fakeEntry, APP_URL);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${APP_URL}/api/channels/callback/fake`);
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(state.length).toBeGreaterThan(20);
  });

  it("makes one Channel per profile the login grants, with the token encrypted", async () => {
    const brand = await createBrand(db, "Acme");
    fakeNetwork.loginTargets = [
      { externalId: "fake-1", displayName: "Acme Main", handle: "acme" },
      { externalId: "fake-2", displayName: "Acme Outlet", handle: "acme.outlet" },
    ];

    const result = await connectFake(brand.id);

    expect(result).toEqual({ connected: ["Acme Main", "Acme Outlet"], reconnected: [] });
    const rows = await db.select().from(channels).where(eq(channels.brandId, brand.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.network === "fake" && row.status === "connected")).toBe(true);
    const main = rows.find((row) => row.externalId === "fake-1")!;
    expect(main.tokenEncrypted).not.toContain("fake-token");
    expect(await decryptToken(main.tokenEncrypted!)).toBe("fake-token-fake-1");
  });

  it("reconnects an existing Channel in place and keeps it in its Brand", async () => {
    const acme = await createBrand(db, "Acme");
    const globex = await createBrand(db, "Globex");
    await connectFake(acme.id);
    const [channel] = await db.select().from(channels);
    await db.update(channels).set({ status: "reconnect_needed" }).where(eq(channels.id, channel.id));

    const result = await connectFake(globex.id);

    expect(result).toEqual({ connected: [], reconnected: ["Fake profile"] });
    const rows = await db.select().from(channels);
    expect(rows).toHaveLength(1);
    expect(rows[0].brandId).toBe(acme.id);
    expect(rows[0].status).toBe("connected");
  });

  it("records which way a Channel connected, and switches it when the same profile connects the other way", async () => {
    const brand = await createBrand(db, "Acme");
    const viaPage: NetworkEntry = { ...fakeEntry, channelSettings: { login: "facebook" } };
    const direct: NetworkEntry = { ...fakeEntry, key: "fake-direct", channelSettings: { login: "instagram" } };

    await completeConnect(db, viaPage, { brandId: brand.id, code: "c", appUrl: APP_URL });
    expect((await db.select().from(channels))[0].settings).toEqual({ login: "facebook" });

    const result = await completeConnect(db, direct, { brandId: brand.id, code: "c", appUrl: APP_URL });
    expect(result.reconnected).toEqual(["Fake profile"]);
    const rows = await db.select().from(channels);
    expect(rows).toHaveLength(1);
    expect(rows[0].settings).toEqual({ login: "instagram" });

    const { url } = beginConnect(direct, APP_URL);
    expect(new URL(url).pathname).toBe("/api/channels/callback/fake-direct");
  });

  it("refuses to connect to a Brand that is gone", async () => {
    await expect(connectFake("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/no longer exists/);
  });
});

describe("managing Channels", () => {
  async function channelWithDelivery(status: "scheduled" | "published") {
    const owner = await seedOwner(db);
    const brand = await createBrand(db, "Acme");
    await connectFake(brand.id);
    const [channel] = await db.select().from(channels);
    const [post] = await db.insert(posts).values({ brandId: brand.id, createdBy: owner.id }).returning();
    await db.insert(deliveries).values({ postId: post.id, channelId: channel.id, scheduledFor: new Date(), status });
    return channel;
  }

  it("moves a Channel to another Brand", async () => {
    const acme = await createBrand(db, "Acme");
    const globex = await createBrand(db, "Globex");
    await connectFake(acme.id);
    const [channel] = await db.select().from(channels);
    expect((await moveChannel(db, channel.id, globex.id)).brandId).toBe(globex.id);
  });

  it("does not move a Channel while a Delivery to it has not finished", async () => {
    const channel = await channelWithDelivery("scheduled");
    const globex = await createBrand(db, "Globex");
    await expect(moveChannel(db, channel.id, globex.id)).rejects.toThrow(/have not finished/);
  });

  it("disconnects an unused Channel but not one with Posts", async () => {
    const used = await channelWithDelivery("published");
    await expect(disconnectChannel(db, used.id)).rejects.toThrow(UserError);

    await db.delete(deliveries);
    await disconnectChannel(db, used.id);
    expect(await db.select().from(channels)).toHaveLength(0);
  });
});

describe("needsReconnect", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  it("is true when the network refused the token", () => {
    expect(needsReconnect({ status: "reconnect_needed", tokenExpiresAt: null }, now)).toBe(true);
  });
  it("is true once the token has run out", () => {
    expect(needsReconnect({ status: "connected", tokenExpiresAt: new Date("2026-11-10T12:00:00Z") }, now)).toBe(true);
  });
  it("is false for a live token or one that never expires", () => {
    expect(needsReconnect({ status: "connected", tokenExpiresAt: new Date("2026-12-10T12:00:00Z") }, now)).toBe(false);
    expect(needsReconnect({ status: "connected", tokenExpiresAt: null }, now)).toBe(false);
  });
});
