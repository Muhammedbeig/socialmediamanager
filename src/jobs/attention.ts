import { eq } from "drizzle-orm";
import type { AttentionHooks } from "@/connectors/types";
import type { Db } from "@/db/client";
import { deliveries, deliveryEvents } from "@/db/schema";
import { type DesktopNotifier, raiseAlert } from "@/notify";
import { takeSetting } from "@/settings/values";

/**
 * Needs attention for one browser task. With a Delivery, it switches that Delivery between
 * Publishing and Needs attention; without one (a Removal or Edit), it only notifies.
 */
export function attentionHooks(
  db: Db,
  options: { channelId: string; label: string; deliveryId?: string; desktop?: DesktopNotifier },
): AttentionHooks {
  return {
    async needed(reason) {
      if (options.deliveryId) {
        await db
          .update(deliveries)
          .set({ status: "needs_attention", lastError: reason })
          .where(eq(deliveries.id, options.deliveryId));
        await db.insert(deliveryEvents).values({ deliveryId: options.deliveryId, type: "needs_attention", detail: { reason } });
      }
      await raiseAlert(
        db,
        {
          kind: "needs_attention",
          title: `${options.label} needs you`,
          body: reason,
          deliveryId: options.deliveryId,
          link: "/needs-attention",
        },
        options.desktop,
      );
    },
    async resolved() {
      if (!options.deliveryId) return;
      await db
        .update(deliveries)
        .set({ status: "publishing", lastError: null })
        .where(eq(deliveries.id, options.deliveryId));
      await db.insert(deliveryEvents).values({ deliveryId: options.deliveryId, type: "attention_cleared" });
    },
    async bringForwardRequested() {
      return (await takeSetting(db, `bring_forward:${options.channelId}`)) !== null;
    },
  };
}
