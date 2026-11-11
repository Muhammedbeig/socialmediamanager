import { randomBytes } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";

// The key that encrypts network tokens lives in Windows Credential Manager, never in the
// database or a file. It is created on first use.
const SERVICE = "Social Publisher";
const ACCOUNT = "token-encryption-key";

let cached: Buffer | undefined;

export async function getTokenKey(): Promise<Buffer> {
  if (cached) return cached;
  const entry = new AsyncEntry(SERVICE, ACCOUNT);
  let stored = await entry.getPassword();
  if (!stored) {
    stored = randomBytes(32).toString("base64");
    await entry.setPassword(stored);
  }
  const key = Buffer.from(stored, "base64");
  if (key.length !== 32) {
    throw new Error("The token encryption key in Windows Credential Manager is not 32 bytes.");
  }
  cached = key;
  return key;
}
