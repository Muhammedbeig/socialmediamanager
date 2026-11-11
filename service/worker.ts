import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seedOwner } from "@/db/seed";
import { requireEnv } from "@/env";
import { type Publisher, startPublisher } from "@/jobs/publisher";
import type { RunDeps } from "@/jobs/run-delivery";

// The background side of the app: applies migrations, then runs the publisher.

export type WorkerOptions = Partial<Pick<RunDeps, "mediaHost" | "desktop">> & {
  log?: (message: string) => void;
};

export async function startWorker(options: WorkerOptions = {}): Promise<{ stop(): Promise<void> }> {
  const log = options.log ?? ((message: string) => console.log(`[worker] ${message}`));
  const connectionString = requireEnv("DATABASE_URL");
  const { db, pool } = createDb(connectionString);
  await runMigrations(db);
  await seedOwner(db);

  const publisher: Publisher = await startPublisher({
    db,
    connectionString,
    deps: { now: () => new Date(), mediaHost: options.mediaHost ?? null, desktop: options.desktop },
    log,
  });
  log("Publisher running. Due Deliveries go out within a few seconds.");

  return {
    async stop() {
      await publisher.stop();
      await pool.end();
    },
  };
}
