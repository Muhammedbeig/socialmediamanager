import { refreshExpiringTokens } from "@/channels/refresh";
import { createDb } from "@/db/client";
import { createR2Host, missingR2Settings } from "@/media/r2";
import { desktopNotifier } from "@/notify/desktop";
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

  const mediaHost = options.mediaHost === undefined ? createR2Host() : options.mediaHost;
  options = { ...options, desktop: options.desktop ?? desktopNotifier() };
  if (!mediaHost) {
    log(`Cloudflare R2 is not set up (missing ${missingR2Settings().join(", ")}). Instagram and Threads media cannot be published until it is.`);
  }

  const publisher: Publisher = await startPublisher({
    db,
    connectionString,
    deps: { now: () => new Date(), mediaHost, desktop: options.desktop },
    log,
  });
  log("Publisher running. Due Deliveries go out within a few seconds.");

  // Keep expiring logins (Threads: 60 days) fresh. Runs now, then every 6 hours.
  const refresh = async () => {
    try {
      const result = await refreshExpiringTokens(db, new Date(), { desktop: options.desktop });
      if (result.refreshed + result.failed > 0) log(`Logins refreshed: ${result.refreshed}, could not refresh: ${result.failed}`);
    } catch (error) {
      log(`Could not refresh logins: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await refresh();
  const refreshTimer = setInterval(refresh, 6 * 60 * 60_000);

  return {
    async stop() {
      clearInterval(refreshTimer);
      await publisher.stop();
      await pool.end();
    },
  };
}
