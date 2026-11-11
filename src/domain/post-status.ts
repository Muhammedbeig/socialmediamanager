import type { DeliveryStatus } from "@/db/schema";

export const POST_STATUSES = [
  "scheduled",
  "publishing",
  "published",
  "partly_published",
  "failed",
  "removed",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  partly_published: "Partly published",
  failed: "Failed",
  removed: "Removed",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  needs_attention: "Needs attention",
  removed: "Removed",
};

/**
 * Post status is never stored: it is computed from the Post's current Deliveries
 * (pass only Deliveries that are not superseded by a Replace).
 *
 * Removed Deliveries are ignored unless every Delivery is Removed.
 */
export function computePostStatus(deliveryStatuses: readonly DeliveryStatus[]): PostStatus {
  const live = deliveryStatuses.filter((s) => s !== "removed");
  if (live.length === 0) {
    return deliveryStatuses.length > 0 ? "removed" : "scheduled";
  }
  if (live.some((s) => s === "publishing" || s === "needs_attention")) return "publishing";
  if (live.every((s) => s === "scheduled")) return "scheduled";
  // Some Deliveries have finished while others still wait, such as after a manual Retry.
  if (live.some((s) => s === "scheduled")) return "publishing";
  if (live.every((s) => s === "published")) return "published";
  if (live.every((s) => s === "failed")) return "failed";
  return "partly_published";
}
