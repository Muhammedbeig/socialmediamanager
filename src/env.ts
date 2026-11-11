import { config } from "dotenv";

// Next.js loads .env.local on its own; the background service, scripts and tests load it here.
// Values already in the environment win, so tests can point DATABASE_URL at the test database.
config({ path: ".env.local", quiet: true });

// The fake network's posts are shared between the worker and the web server through a file
// (tests keep them in memory instead).
if (process.env.ENABLE_FAKE_CONNECTOR === "1" && !process.env.VITEST && !process.env.FAKE_NETWORK_FILE) {
  process.env.FAKE_NETWORK_FILE = `${process.env.DATA_DIR ?? "data"}/fake-network.json`;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
