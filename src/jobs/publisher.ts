import { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { beat } from "@/settings/heartbeat";
import { deliveries } from "@/db/schema";
import { type RunDeps, dueCondition, runDelivery } from "./run-delivery";

// The publisher: one pg-boss job per due Delivery.
// The database is the source of truth for what is due, so the web app never talks to the queue:
// it saves Deliveries, and the dispatcher here turns every due one into a job. A Delivery due while
// the laptop slept is due when it wakes, and its actual time is recorded when the job runs.

export const DELIVER_QUEUE = "deliver";
const DISPATCH_INTERVAL_MS = 5_000;

type DeliverJob = { deliveryId: string };
type Send = (deliveryId: string) => Promise<unknown>;

/** Sends a job for every Delivery that is due. A Delivery already queued or running is not sent twice. */
export async function dispatchDue(db: Db, send: Send, now: Date): Promise<number> {
  const due = await db.select({ id: deliveries.id }).from(deliveries).where(dueCondition(now)).limit(200);
  for (const row of due) await send(row.id);
  return due.length;
}

export type Publisher = { stop(): Promise<void>; dispatchNow(): Promise<void> };

export async function startPublisher(options: {
  db: Db;
  connectionString: string;
  deps: RunDeps;
  /** Deliveries published at the same time. */
  concurrency?: number;
  log?: (message: string) => void;
}): Promise<Publisher> {
  const { db, deps } = options;
  const log = options.log ?? ((message: string) => console.log(message));
  const boss = new PgBoss({ connectionString: options.connectionString, schema: "pgboss" });
  boss.on("error", (error) => log(`Job queue error: ${error instanceof Error ? error.message : String(error)}`));
  await boss.start();
  // "stately" with the Delivery ID as key: at most one queued and one running job per Delivery.
  // Retries are decided per error by the runner, so pg-boss itself never retries.
  await boss.createQueue(DELIVER_QUEUE, { policy: "stately", retryLimit: 0, expireInSeconds: 15 * 60 });

  await boss.work<DeliverJob>(
    DELIVER_QUEUE,
    { localConcurrency: options.concurrency ?? 4, batchSize: 1, pollingIntervalSeconds: 2 },
    async ([job]) => {
      const outcome = await runDelivery(db, job.data.deliveryId, deps);
      if (outcome !== "skipped") log(`Delivery ${job.data.deliveryId}: ${outcome}`);
      return { outcome };
    },
  );

  const send: Send = (deliveryId) =>
    boss.send(DELIVER_QUEUE, { deliveryId } satisfies DeliverJob, { singletonKey: deliveryId });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await beat(db, deps.now());
      await dispatchDue(db, send, deps.now());
    } catch (error) {
      log(`Could not check for due Deliveries: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  await tick();
  const timer = setInterval(tick, DISPATCH_INTERVAL_MS);

  return {
    dispatchNow: tick,
    async stop() {
      clearInterval(timer);
      await boss.stop({ graceful: true, timeout: 30_000 });
    },
  };
}
