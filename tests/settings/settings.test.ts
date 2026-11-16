import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { deliveries } from "@/db/schema";
import { calendarMonth, dayKey, monthStart } from "@/posts/calendar";
import { beat, lastHeartbeat, workerRunning } from "@/settings/heartbeat";
import { setupStatus } from "@/settings/status";
import { openTestDb, resetTestDb } from "../helpers/db";
import { deliveryTo, fakeChannel } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
});
afterAll(() => close?.());
beforeEach(() => resetTestDb(db));

describe("publisher heartbeat", () => {
  it("shows the publisher as running only while it keeps beating", async () => {
    const now = new Date("2026-11-16T10:00:00Z");
    expect(workerRunning(await lastHeartbeat(db), now)).toBe(false);
    await beat(db, now);
    await beat(db, now);
    expect(workerRunning(await lastHeartbeat(db), new Date(now.getTime() + 30_000))).toBe(true);
    expect(workerRunning(await lastHeartbeat(db), new Date(now.getTime() + 120_000))).toBe(false);
  });
});

describe("setup checklist", () => {
  it("says what is missing and where to put it", async () => {
    const saved = { ...process.env };
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.R2_ACCOUNT_ID;
    try {
      const items = await setupStatus(db);
      const byId = Object.fromEntries(items.map((item) => [item.id, item]));
      expect(byId.database.ok).toBe(true);
      expect(byId.meta).toMatchObject({ ok: false });
      expect(byId.meta.detail).toContain("FACEBOOK_APP_ID");
      expect(byId.r2.detail).toContain("R2_ACCOUNT_ID");
      expect(byId.worker.ok).toBe(false);
    } finally {
      process.env = saved;
    }
  });
});

describe("calendar", () => {
  it("puts each Post on the day it goes out, and leaves removed ones out", async () => {
    const setup = await fakeChannel(db);
    const morning = new Date(2026, 10, 16, 9, 30);
    const { post } = await deliveryTo(db, setup, { caption: "Monday post", scheduledFor: morning });
    const removed = await deliveryTo(db, setup, { caption: "Gone", scheduledFor: morning });
    await db.update(deliveries).set({ status: "removed" }).where(eq(deliveries.id, removed.delivery.id));
    await deliveryTo(db, setup, { caption: "Next month", scheduledFor: new Date(2026, 11, 2, 9) });

    const days = await calendarMonth(db, monthStart("2026-11"));
    expect([...days.keys()]).toEqual([dayKey(morning)]);
    expect(days.get(dayKey(morning))).toEqual([expect.objectContaining({ id: post.id, caption: "Monday post", status: "scheduled" })]);
  });

  it("reads the month from the address, falling back to this month", () => {
    expect(monthStart("2026-02")).toEqual(new Date(2026, 1, 1));
    expect(monthStart("garbage", new Date(2026, 10, 16))).toEqual(new Date(2026, 10, 1));
  });
});
