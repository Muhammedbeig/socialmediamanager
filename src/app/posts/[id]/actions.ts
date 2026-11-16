"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { type RemovalReport, editDelivery, removeDeliveries, replaceDelivery } from "@/deliveries/manage";
import { UserError } from "@/domain/errors";
import { retryDelivery } from "@/jobs/run-delivery";
import { type ClientAsset, toClientAsset } from "@/media/client-asset";
import { listAssets } from "@/media/library";
import { desktopNotifier } from "@/notify/desktop";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function attempt(postId: string, body: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await body();
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/posts");
    return { ok: true, message: message ?? undefined };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function retryAction(postId: string, deliveryId: string): Promise<ActionResult> {
  return attempt(postId, async () => {
    if (!(await retryDelivery(getDb(), deliveryId))) throw new UserError("Only a Failed Delivery can be retried.");
    return "Retrying now.";
  });
}

export async function editAction(postId: string, deliveryId: string, text: string): Promise<ActionResult> {
  return attempt(postId, async () => {
    await editDelivery(getDb(), deliveryId, text);
    return "Edited.";
  });
}

export async function replaceAction(
  postId: string,
  deliveryId: string,
  text: string,
  mediaIds: string[] | null,
): Promise<ActionResult> {
  return attempt(postId, async () => {
    await replaceDelivery(getDb(), deliveryId, text, { mediaIds });
    return "The old post was removed. The new one is being published.";
  });
}

/**
 * Removal reports each Channel's result. The screen refreshes when the Member closes the report,
 * so the report stays on screen even when the last Delivery is removed.
 */
export async function removeAction(_postId: string, deliveryIds: string[]): Promise<RemovalReport[]> {
  return removeDeliveries(getDb(), deliveryIds, { desktop: desktopNotifier() });
}

/** The media library, for choosing new media in a Replace. */
export async function listLibraryAction(): Promise<ClientAsset[]> {
  return (await listAssets(getDb())).map(toClientAsset);
}
