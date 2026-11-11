import type { mediaAssets } from "@/db/schema";

/** What the browser needs to know about a library file. No disk paths leave the server. */
export type ClientAsset = {
  id: string;
  kind: "image" | "video";
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export function toClientAsset(asset: typeof mediaAssets.$inferSelect): ClientAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function thumbUrl(assetId: string): string {
  return `/api/media/${assetId}/thumb`;
}

export function originalUrl(assetId: string): string {
  return `/api/media/${assetId}/original`;
}
