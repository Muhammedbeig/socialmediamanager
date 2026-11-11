import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/secrets/tokens";

describe("network token encryption", () => {
  it("stores a token unreadable and reads it back", async () => {
    const stored = await encryptToken("secret-token-123");
    expect(stored).not.toContain("secret-token-123");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(await decryptToken(stored)).toBe("secret-token-123");
  });

  it("encrypts the same token differently each time", async () => {
    expect(await encryptToken("same")).not.toBe(await encryptToken("same"));
  });

  it("refuses a stored token that was tampered with", async () => {
    const stored = await encryptToken("secret-token-123");
    const parts = stored.split(".");
    parts[3] = Buffer.from("something else").toString("base64url");
    await expect(decryptToken(parts.join("."))).rejects.toThrow();
  });

  it("refuses a value in an unknown format", async () => {
    await expect(decryptToken("plain-text-token")).rejects.toThrow(/known format/);
  });
});
