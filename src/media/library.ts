import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mediaAssets, mediaVariants, postMedia } from "@/db/schema";
import { UserError } from "@/domain/errors";
import { dataPath, ffmpeg } from "./ffmpeg";
import { probeFile } from "./probe";

// The media library: uploaded photos and videos, reusable across Posts.
// Files live under the data directory; the database stores paths relative to it.

export type MediaAsset = typeof mediaAssets.$inferSelect;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-msvideo": ".avi",
};

export function thumbnailPath(asset: Pick<MediaAsset, "sha256">): string {
  return dataPath(path.join("thumbs", `${asset.sha256}.jpg`));
}

export function originalPath(asset: Pick<MediaAsset, "path">): string {
  return dataPath(asset.path);
}

async function makeThumbnail(source: string, target: string, kind: "image" | "video", durationMs: number | null) {
  await mkdir(path.dirname(target), { recursive: true });
  // For a video, take a frame one second in (or the first frame of a very short one).
  const seek = kind === "video" && (durationMs ?? 0) > 1500 ? ["-ss", "1"] : [];
  await ffmpeg([...seek, "-i", source, "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", target]);
}

/** Saves an uploaded file into the library. The same file uploaded twice is stored once. */
export async function saveUpload(
  db: Db,
  upload: { name: string; body: ReadableStream<Uint8Array> | Readable },
): Promise<MediaAsset> {
  const tmpDir = dataPath("tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, randomUUID());

  try {
    const hash = createHash("sha256");
    const source = upload.body instanceof Readable ? upload.body : Readable.fromWeb(upload.body as never);
    source.on("data", (chunk: Buffer) => hash.update(chunk));
    await pipeline(source, createWriteStream(tmpFile));
    const sha256 = hash.digest("hex");

    const [existing] = await db.select().from(mediaAssets).where(eq(mediaAssets.sha256, sha256));
    if (existing) return existing;

    const { size } = await stat(tmpFile);
    if (size === 0) throw new UserError("That file is empty.");
    const probe = await probeFile(tmpFile);

    const relative = path.join("originals", `${sha256}${EXTENSIONS[probe.mimeType] ?? ""}`);
    await mkdir(dataPath("originals"), { recursive: true });
    await rename(tmpFile, dataPath(relative));
    await makeThumbnail(dataPath(relative), thumbnailPath({ sha256 }), probe.kind, probe.durationMs);

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        kind: probe.kind,
        originalName: upload.name.slice(0, 200) || "upload",
        path: relative,
        mimeType: probe.mimeType,
        sizeBytes: size,
        width: probe.width,
        height: probe.height,
        durationMs: probe.durationMs,
        sha256,
      })
      .returning();
    return asset;
  } finally {
    await rm(tmpFile, { force: true });
  }
}

export async function listAssets(db: Db, limit = 200): Promise<MediaAsset[]> {
  return db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt)).limit(limit);
}

/** Deletes a file from the library. Media used by a Post stays, so the Post keeps its history. */
export async function deleteAsset(db: Db, assetId: string): Promise<void> {
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
  if (!asset) return;
  const [used] = await db.select().from(postMedia).where(eq(postMedia.assetId, assetId)).limit(1);
  if (used) throw new UserError("A Post uses this file, so it stays in the library.");

  const variants = await db.select().from(mediaVariants).where(eq(mediaVariants.assetId, assetId));
  await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
  await Promise.all([
    rm(originalPath(asset), { force: true }),
    rm(thumbnailPath(asset), { force: true }),
    ...variants.map((variant) => rm(dataPath(variant.path), { force: true })),
  ]);
}
