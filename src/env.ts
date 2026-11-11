import { config } from "dotenv";

// Next.js loads .env.local on its own; the background service, scripts and tests load it here.
// Values already in the environment win, so tests can point DATABASE_URL at the test database.
config({ path: ".env.local", quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
