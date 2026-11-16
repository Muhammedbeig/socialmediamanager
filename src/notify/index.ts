import type { Db } from "@/db/client";
import { notifications } from "@/db/schema";

export type Alert = {
  kind: "delivery_failed" | "removal_failed" | "channel_reconnect" | "needs_attention";
  title: string;
  body: string;
  deliveryId?: string;
  /** App path the alert opens, such as /posts/<id>. */
  link: string;
};

export type DesktopNotifier = (alert: Alert) => void;

/** Records an alert for the in-app badge and shows it as a desktop notification. */
export async function raiseAlert(db: Db, alert: Alert, desktop?: DesktopNotifier): Promise<void> {
  await db.insert(notifications).values({
    kind: alert.kind,
    title: alert.title,
    body: alert.body,
    deliveryId: alert.deliveryId ?? null,
  });
  try {
    desktop?.(alert);
  } catch (error) {
    // A notification that cannot be shown must never stop a Delivery.
    console.error("Desktop notification failed", error);
  }
}
