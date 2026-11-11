// Applies migrations and seeds the owner Member: `npm run db:setup`.
import { requireEnv } from "@/env";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seedOwner } from "@/db/seed";

async function main() {
  const { db, pool } = createDb(requireEnv("DATABASE_URL"));
  try {
    await runMigrations(db);
    const owner = await seedOwner(db);
    console.log(`Database ready. Member: ${owner.name} (${owner.role}).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
