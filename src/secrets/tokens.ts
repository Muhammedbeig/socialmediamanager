import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getTokenKey } from "./keystore";

// Network tokens are stored as "v1.<iv>.<auth tag>.<ciphertext>", AES-256-GCM, base64url parts.

export async function encryptToken(plain: string): Promise<string> {
  const key = await getTokenKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64url"));
  return `v1.${parts.join(".")}`;
}

export async function decryptToken(stored: string): Promise<string> {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) {
    throw new Error("Stored token is not in a known format.");
  }
  const key = await getTokenKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
