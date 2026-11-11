"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { type RemovalReport, editDelivery, removeDeliveries, replaceDelivery } from "@/deliveries/manage";
import { UserError } from "@/domain/errors";
import { retryDelivery } from "@/jobs/run-delivery";
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

export async function replaceAction(postId: string, deliveryId: string, text: string): Promise<ActionResult> {
  return attempt(postId, async () => {
    await replaceDelivery(getDb(), deliveryId, text);
    return "The old post was removed. The new one is being published.";
  });
}

export async function removeAction(postId: string, deliveryIds: string[]): Promise<RemovalReport[]> {
  const reports = await removeDeliveries(getDb(), deliveryIds, { desktop: desktopNotifier() });
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/posts");
  return reports;
}
