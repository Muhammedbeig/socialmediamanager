import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { originalPath, thumbnailPath } from "@/media/library";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Serves a library file to the app's own screens: /api/media/<id>/thumb or /original.
// Supports byte ranges so a video can be scrubbed in the preview.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; variant: string }> }) {
  const { id, variant } = await context.params;
  if (!UUID.test(id) || (variant !== "thumb" && variant !== "original")) {
    return new Response("Not found", { status: 404 });
  }
  const [asset] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, id));
  if (!asset) return new Response("Not found", { status: 404 });

  const filePath = variant === "thumb" ? thumbnailPath(asset) : originalPath(asset);
  const contentType = variant === "thumb" ? "image/jpeg" : asset.mimeType;
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Files are stored under their content hash, so they never change.
    "Cache-Control": "private, max-age=31536000, immutable",
  });

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { headers });
}
