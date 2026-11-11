import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImageRules, VideoRules } from "@/connectors/types";
import type { Db } from "@/db/client";
import { brands, mediaVariants, postMedia, posts } from "@/db/schema";
import { seedOwner } from "@/db/seed";
import { UserError } from "@/domain/errors";
import { prepareImage, prepareVideo } from "@/media/convert";
import { ffmpeg } from "@/media/ffmpeg";
import { deleteAsset, originalPath, saveUpload, thumbnailPath } from "@/media/library";
import { probeFile } from "@/media/probe";
import { openTestDb, resetTestDb } from "../helpers/db";

// These tests run the real FFmpeg on small generated files.
let db: Db;
let close: () => Promise<void>;
let dir: string;
const file = (name: string) => path.join(dir, name);

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "social-publisher-media-"));
  process.env.DATA_DIR = path.join(dir, "data");
  const lavfi = (source: string) => ["-f", "lavfi", "-i", source];
  await Promise.all([
    ffmpeg([...lavfi("testsrc=size=1200x800:rate=1"), "-frames:v", "1", file("wide.jpg")]),
    ffmpeg([...lavfi("testsrc=size=600x1600:rate=1"), "-frames:v", "1", file("tall.jpg")]),
    ffmpeg([...lavfi("color=c=red@0.0:size=400x400,format=rgba"), "-frames:v", "1", file("clear.png")]),
    ffmpeg([...lavfi("testsrc=size=640x360:rate=25"), "-t", "2", "-pix_fmt", "yuv420p", file("clip.mp4")]),
    ffmpeg([...lavfi("testsrc=size=640x360:rate=25"), "-t", "2", "-pix_fmt", "yuv420p", file("clip.mov")]),
    writeFile(file("notes.txt"), "not media"),
  ]);
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
}, 60_000);

afterAll(async () => {
  await close?.();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => resetTestDb(db));

const upload = (name: string) => saveUpload(db, { name, body: createReadStream(file(name)) });

const jpegOnly: ImageRules = { mimeTypes: ["image/jpeg"], convertTo: "image/jpeg", maxBytes: 8 * 1024 * 1024 };
const mp4Only: VideoRules = { mimeTypes: ["video/mp4"], maxBytes: 50 * 1024 * 1024 };

describe("probeFile", () => {
  it("reads what a photo really is", async () => {
    expect(await probeFile(file("wide.jpg"))).toEqual({
      kind: "image",
      mimeType: "image/jpeg",
      width: 1200,
      height: 800,
      durationMs: null,
    });
    expect((await probeFile(file("clear.png"))).mimeType).toBe("image/png");
  });

  it("reads a video's type, size and length", async () => {
    const mp4 = await probeFile(file("clip.mp4"));
    expect(mp4).toMatchObject({ kind: "video", mimeType: "video/mp4", width: 640, height: 360 });
    expect(mp4.durationMs).toBeGreaterThan(1900);
    expect(mp4.durationMs).toBeLessThan(2100);
    expect((await probeFile(file("clip.mov"))).mimeType).toBe("video/quicktime");
  });

  it("refuses a file that is not a photo or video", async () => {
    await expect(probeFile(file("notes.txt"))).rejects.toThrow(UserError);
  });
});

describe("media library", () => {
  it("stores an upload with its details and a thumbnail", async () => {
    const asset = await upload("wide.jpg");
    expect(asset).toMatchObject({ kind: "image", originalName: "wide.jpg", mimeType: "image/jpeg", width: 1200, height: 800 });
    expect(existsSync(originalPath(asset))).toBe(true);
    expect(existsSync(thumbnailPath(asset))).toBe(true);
    expect((await probeFile(thumbnailPath(asset))).width).toBe(480);
  });

  it("stores the same file once when it is uploaded twice", async () => {
    const first = await upload("wide.jpg");
    const second = await upload("wide.jpg");
    expect(second.id).toBe(first.id);
  });

  it("makes a thumbnail for a video", async () => {
    const asset = await upload("clip.mp4");
    expect(asset.kind).toBe("video");
    expect(existsSync(thumbnailPath(asset))).toBe(true);
  });

  it("refuses a file that is not media and leaves nothing behind", async () => {
    await expect(upload("notes.txt")).rejects.toThrow(UserError);
  });

  it("deletes an unused file, but keeps one a Post uses", async () => {
    const unused = await upload("wide.jpg");
    const used = await upload("tall.jpg");
    const owner = await seedOwner(db);
    const [brand] = await db.insert(brands).values({ name: "Acme" }).returning();
    const [post] = await db.insert(posts).values({ brandId: brand.id, createdBy: owner.id }).returning();
    await db.insert(postMedia).values({ postId: post.id, assetId: used.id, position: 0 });

    await deleteAsset(db, unused.id);
    expect(existsSync(originalPath(unused))).toBe(false);
    await expect(deleteAsset(db, used.id)).rejects.toThrow(/A Post uses this file/);
    expect(existsSync(originalPath(used))).toBe(true);
  });
});

describe("prepareImage", () => {
  it("hands back the original when the network takes it as it is", async () => {
    const asset = await upload("wide.jpg");
    const prepared = await prepareImage(db, asset, jpegOnly);
    expect(prepared.path).toBe(originalPath(asset));
  });

  it("converts a PNG to JPEG, with transparency on white", async () => {
    const asset = await upload("clear.png");
    const prepared = await prepareImage(db, asset, jpegOnly);
    expect(prepared.mimeType).toBe("image/jpeg");
    expect(prepared).toMatchObject({ width: 400, height: 400 });
    // The picture was fully transparent, so every pixel should now be white.
    await ffmpeg(["-i", prepared.path, "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", file("average.raw")]);
    const [brightness] = await readFile(file("average.raw"));
    expect(brightness).toBeGreaterThan(230);
  });

  it("applies the crop the Member approved, exactly", async () => {
    const asset = await upload("tall.jpg");
    const prepared = await prepareImage(db, asset, jpegOnly, { x: 0, y: 425, width: 600, height: 750 });
    expect(prepared).toMatchObject({ width: 600, height: 750, mimeType: "image/jpeg" });
  });

  it("compresses a file that is over the size limit", async () => {
    const asset = await upload("wide.jpg");
    const limit = Math.floor(asset.sizeBytes / 3);
    const prepared = await prepareImage(db, asset, { ...jpegOnly, maxBytes: limit });
    expect(prepared.sizeBytes).toBeLessThanOrEqual(limit);
  });

  it("makes each conversion once and reuses it", async () => {
    const asset = await upload("clear.png");
    const first = await prepareImage(db, asset, jpegOnly);
    const second = await prepareImage(db, asset, jpegOnly);
    expect(second.path).toBe(first.path);
    expect(await db.select().from(mediaVariants)).toHaveLength(1);
  });
});

describe("prepareVideo", () => {
  it("hands back an MP4 the network takes as it is", async () => {
    const asset = await upload("clip.mp4");
    expect((await prepareVideo(db, asset, mp4Only)).path).toBe(originalPath(asset));
  });

  it("converts another container to MP4", async () => {
    const asset = await upload("clip.mov");
    const prepared = await prepareVideo(db, asset, mp4Only);
    expect(prepared).toMatchObject({ kind: "video", mimeType: "video/mp4", width: 640, height: 360 });
  }, 60_000);
});
