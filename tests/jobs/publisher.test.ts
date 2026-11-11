import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeNetwork } from "@/connectors/fake";
import type { Db } from "@/db/client";
import { deliveries } from "@/db/schema";
import { type Publisher, startPublisher } from "@/jobs/publisher";
import { requireEnv } from "@/env";
import { openTestDb, resetTestDb } from "../helpers/db";
import { deliveryTo, fakeChannel } from "../helpers/fixtures";

// The real job queue (pg-boss) running in the test database.
let db: Db;
let close: () => Promise<void>;
let publisher: Publisher | undefined;

beforeAll(async () => {
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
  await resetTestDb(db);
  fakeNetwork.reset();
});
afterAll(async () => {
  await publisher?.stop();
  await close?.();
});

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe("publisher", () => {
  it("picks up a due Delivery through the job queue and publishes it", async () => {
    const setup = await fakeChannel(db);
    const { delivery } = await deliveryTo(db, setup, { caption: "Through the queue", scheduledFor: new Date() });

    publisher = await startPublisher({
      db,
      connectionString: requireEnv("TEST_DATABASE_URL"),
      deps: { now: () => new Date(), mediaHost: null },
      log: () => {},
    });

    const row = await waitFor(
      async () => (await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0],
      (value) => value.status === "published",
    );
    expect(row.status).toBe("published");
    expect([...fakeNetwork.posts.values()].map((p) => p.caption)).toEqual(["Through the queue"]);
  }, 30_000);
});
