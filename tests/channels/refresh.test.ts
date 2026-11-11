import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { refreshExpiringTokens } from "@/channels/refresh";
import { fakeNetwork } from "@/connectors/fake";
import type { Db } from "@/db/client";
import { channels, notifications } from "@/db/schema";
import { decryptToken } from "@/secrets/tokens";
import { openTestDb, resetTestDb } from "../helpers/db";
import { fakeChannel } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
const NOW = new Date("2026-11-11T09:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60_000);

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

async function channelExpiring(at: Date | null) {
  const { channel } = await fakeChannel(db);
  await db.update(channels).set({ tokenExpiresAt: at }).where(eq(channels.id, channel.id));
  return channel.id;
}
const read = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0];

describe("refreshExpiringTokens", () => {
  it("extends a login that expires within 10 days", async () => {
    const id = await channelExpiring(days(5));
    expect(await refreshExpiringTokens(db, NOW)).toEqual({ refreshed: 1, failed: 0 });
    const channel = await read(id);
    expect(await decryptToken(channel.tokenEncrypted!)).toBe("fake-refreshed-1");
    expect(channel.tokenExpiresAt!.getTime()).toBeGreaterThan(days(30).getTime());
  });

  it("leaves logins with plenty of time, and ones that never expire", async () => {
    await channelExpiring(days(40));
    expect(await refreshExpiringTokens(db, NOW)).toEqual({ refreshed: 0, failed: 0 });
  });

  it("keeps trying quietly before expiry, then asks for a reconnect once it has run out", async () => {
    const id = await channelExpiring(days(2));
    fakeNetwork.refreshFails = true;
    expect(await refreshExpiringTokens(db, NOW)).toEqual({ refreshed: 0, failed: 1 });
    expect((await read(id)).status).toBe("connected");
    expect(await db.select().from(notifications)).toHaveLength(0);

    expect(await refreshExpiringTokens(db, days(3))).toEqual({ refreshed: 0, failed: 1 });
    expect((await read(id)).status).toBe("reconnect_needed");
    const alerts = await db.select().from(notifications);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("channel_reconnect");

    // A Channel waiting for a reconnect is not tried again.
    expect(await refreshExpiringTokens(db, days(4))).toEqual({ refreshed: 0, failed: 0 });
  });
});
