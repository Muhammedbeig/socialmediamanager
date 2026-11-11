"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { seedOwner } from "@/db/seed";
import { UserError } from "@/domain/errors";
import { createPost } from "@/posts/service";

const cropSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const payloadSchema = z.object({
  brandId: z.uuid(),
  caption: z.string().max(100_000),
  assetIds: z.array(z.uuid()).max(20),
  deliveries: z
    .array(
      z.object({
        channelId: z.uuid(),
        captionOverride: z.string().max(100_000).nullable(),
        approvedCrops: z.record(z.uuid(), cropSchema),
      }),
    )
    .max(100),
  /** ISO time in the laptop's time zone, or null to publish now. */
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
});

export type ComposePayload = z.infer<typeof payloadSchema>;
export type ComposeResult = { ok: true; postId: string } | { ok: false; error: string };

export async function createPostAction(payload: ComposePayload): Promise<ComposeResult> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "The Post could not be read. Reload the page and try again." };
  const db = getDb();
  try {
    // v1 has one Member, the owner (docs/adr/0002).
    const owner = await seedOwner(db);
    const { post } = await createPost(db, owner.id, {
      ...parsed.data,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
    });
    revalidatePath("/posts");
    return { ok: true, postId: post.id };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: error.message };
    throw error;
  }
}
