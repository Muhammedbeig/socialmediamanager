import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MediaHost } from "./host";

// Cloudflare R2 through its S3-compatible API. Files live there only while a Delivery that
// needs them is being published; the bucket's 1-day lifecycle rule is the safety net.

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

const R2_ENV = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL"];

export function missingR2Settings(): string[] {
  return R2_ENV.filter((name) => !process.env[name]);
}

/** Null when the R2 settings are not in .env.local yet. */
export function createR2Host(): MediaHost | null {
  if (missingR2Settings().length > 0) return null;
  const bucket = process.env.R2_BUCKET!;
  const publicBase = process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, "");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  return {
    async put(filePath, mimeType) {
      // A random name, so a public URL cannot be guessed before or after its short life.
      const key = `deliveries/${randomUUID()}${EXTENSIONS[mimeType] ?? ""}`;
      const { size } = await stat(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: mimeType,
        }),
      );
      return { key, url: `${publicBase}/${key}` };
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
