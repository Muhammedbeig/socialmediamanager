import { createHash } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { ImageRules, PreparedMedia, VideoRules } from "@/connectors/types";
import type { Db } from "@/db/client";
import { type CropRect, type TrimRange, mediaVariants } from "@/db/schema";
import { dataPath, ffmpeg } from "./ffmpeg";
import { type MediaAsset, originalPath } from "./library";
import { probeFile } from "./probe";

// Makes the copy of a file that one network will accept. Format, codec and file size are
// converted automatically. A crop is applied only when the Member approved it in the preview.
// Each distinct conversion is made once and kept as a variant.

const AUDIO_KBPS = 128;

async function findVariant(db: Db, assetId: string, spec: string) {
  const [variant] = await db
    .select()
    .from(mediaVariants)
    .where(and(eq(mediaVariants.assetId, assetId), eq(mediaVariants.spec, spec)));
  if (!variant) return null;
  try {
    await stat(dataPath(variant.path));
    return variant;
  } catch {
    // The file was removed by hand; make it again.
    await db.delete(mediaVariants).where(eq(mediaVariants.id, variant.id));
    return null;
  }
}

async function saveVariant(db: Db, asset: MediaAsset, spec: string, relative: string): Promise<PreparedMedia> {
  const probe = await probeFile(dataPath(relative));
  const { size } = await stat(dataPath(relative));
  await db
    .insert(mediaVariants)
    .values({
      assetId: asset.id,
      spec,
      path: relative,
      mimeType: probe.mimeType,
      sizeBytes: size,
      width: probe.width,
      height: probe.height,
    })
    .onConflictDoNothing();
  return {
    kind: asset.kind,
    path: dataPath(relative),
    mimeType: probe.mimeType,
    sizeBytes: size,
    width: probe.width,
    height: probe.height,
  };
}

function variantFile(asset: MediaAsset, spec: string, extension: string): string {
  const name = createHash("sha256").update(spec).digest("hex").slice(0, 16);
  return path.join("variants", asset.id, `${name}${extension}`);
}

function asPrepared(asset: MediaAsset): PreparedMedia {
  return {
    kind: asset.kind,
    path: originalPath(asset),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
  };
}

export async function prepareImage(
  db: Db,
  asset: MediaAsset,
  rules: ImageRules,
  crop?: CropRect,
): Promise<PreparedMedia> {
  const width = crop?.width ?? asset.width ?? 0;
  const tooWide = rules.maxWidth !== undefined && width > rules.maxWidth;
  const accepted = rules.mimeTypes.includes(asset.mimeType);
  if (accepted && !crop && !tooWide && asset.sizeBytes <= rules.maxBytes) return asPrepared(asset);

  const target = accepted && asset.mimeType === "image/png" ? "image/png" : rules.convertTo;
  const cropSpec = crop ? `crop:${crop.x},${crop.y},${crop.width},${crop.height}` : "nocrop";
  const spec = `${target}|max${rules.maxBytes}|w${rules.maxWidth ?? "any"}|${cropSpec}`;
  const existing = await findVariant(db, asset.id, spec);
  if (existing) {
    return {
      kind: "image",
      path: dataPath(existing.path),
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      width: existing.width,
      height: existing.height,
    };
  }

  const relative = variantFile(asset, spec, target === "image/png" ? ".png" : ".jpg");
  const output = dataPath(relative);
  await mkdir(path.dirname(output), { recursive: true });

  // Try the best quality first, then trade quality and finally size until the file fits.
  const attempts: { quality: number; scale: number }[] = [
    { quality: 2, scale: 1 },
    { quality: 4, scale: 1 },
    { quality: 7, scale: 1 },
    { quality: 7, scale: 0.75 },
    { quality: 10, scale: 0.5 },
    { quality: 14, scale: 0.35 },
  ];
  for (const attempt of attempts) {
    const filters: string[] = [];
    if (crop) filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
    const limit = rules.maxWidth ? `min(${rules.maxWidth},iw*${attempt.scale})` : `iw*${attempt.scale}`;
    if (rules.maxWidth || attempt.scale !== 1) filters.push(`scale='trunc(${limit}/2)*2':-2`);
    // JPEG has no transparency: put transparent pictures on white instead of black.
    const flatten = target === "image/jpeg";
    const chain = filters.length > 0 ? `${filters.join(",")},` : "";
    const graph = flatten
      ? `[0:v]${chain}format=rgba,split[fg][shape];[shape]drawbox=c=white@1:t=fill:replace=1[bg];[bg][fg]overlay=format=auto`
      : `[0:v]${chain}null`;
    const encode = target === "image/jpeg" ? ["-q:v", String(attempt.quality), "-pix_fmt", "yuvj420p"] : [];
    await ffmpeg(["-i", originalPath(asset), "-filter_complex", graph, "-frames:v", "1", ...encode, output]);
    if ((await stat(output)).size <= rules.maxBytes) return saveVariant(db, asset, spec, relative);
  }
  await rm(output, { force: true });
  throw new Error(`Could not make "${asset.originalName}" small enough for this network.`);
}

export async function prepareVideo(
  db: Db,
  asset: MediaAsset,
  rules: VideoRules,
  trim?: TrimRange,
): Promise<PreparedMedia> {
  if (!trim && rules.mimeTypes.includes(asset.mimeType) && asset.sizeBytes <= rules.maxBytes) return asPrepared(asset);

  const trimSpec = trim ? `trim:${trim.startMs}-${trim.endMs}` : "notrim";
  const spec = `video/mp4|max${rules.maxBytes}|${trimSpec}`;
  const existing = await findVariant(db, asset.id, spec);
  if (existing) {
    return {
      kind: "video",
      path: dataPath(existing.path),
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      width: existing.width,
      height: existing.height,
    };
  }

  const relative = variantFile(asset, spec, ".mp4");
  const output = dataPath(relative);
  await mkdir(path.dirname(output), { recursive: true });
  // An approved trim: seek to the start and stop at the end (re-encoded, so the cut is exact).
  const cut = trim ? ["-ss", (trim.startMs / 1000).toFixed(3), "-to", (trim.endMs / 1000).toFixed(3)] : [];
  const common = [
    ...cut,
    "-i", originalPath(asset),
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-vf", "scale='trunc(iw/2)*2':'trunc(ih/2)*2'",
    "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`,
    "-movflags", "+faststart",
  ];

  // First a visually clean encode. If that is still too big, aim the bitrate at the limit.
  await ffmpeg([...common, "-crf", "23", output]);
  if ((await stat(output)).size > rules.maxBytes) {
    const keptMs = trim ? trim.endMs - trim.startMs : (asset.durationMs ?? 1000);
    const seconds = Math.max(1, keptMs / 1000);
    const videoKbps = Math.floor((rules.maxBytes * 8 * 0.92) / seconds / 1000) - AUDIO_KBPS;
    if (videoKbps < 150) {
      await rm(output, { force: true });
      throw new Error(`"${asset.originalName}" is too long to fit this network's file size limit.`);
    }
    await ffmpeg([...common, "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`, output]);
    if ((await stat(output)).size > rules.maxBytes) {
      await rm(output, { force: true });
      throw new Error(`Could not make "${asset.originalName}" small enough for this network.`);
    }
  }
  return saveVariant(db, asset, spec, relative);
}
