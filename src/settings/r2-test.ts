import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createR2Host, missingR2Settings } from "@/media/r2";

/**
 * Checks R2 the way a Delivery uses it: upload a small file, fetch it from its public URL as a
 * network would, then delete it. Returns what went wrong, or null when all three steps worked.
 */
export async function testR2(): Promise<string | null> {
  const missing = missingR2Settings();
  if (missing.length > 0) return `Add ${missing.join(", ")} to .env.local first.`;
  const host = createR2Host()!;
  const dir = await mkdtemp(path.join(os.tmpdir(), "r2-test-"));
  const file = path.join(dir, "check.png");
  // A 1×1 transparent PNG.
  await writeFile(
    file,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
  );
  let key: string | null = null;
  try {
    let url: string;
    try {
      ({ key, url } = await host.put(file, "image/png"));
    } catch (error) {
      return `Upload failed: ${error instanceof Error ? error.message : String(error)}. Check the account ID, bucket name and API token.`;
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!response || !response.ok) {
      return `Uploaded, but ${url} did not answer publicly (${response ? `HTTP ${response.status}` : "no answer"}). Check the bucket's public URL setting and R2_PUBLIC_BASE_URL.`;
    }
    return null;
  } finally {
    if (key) await host.remove(key).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
