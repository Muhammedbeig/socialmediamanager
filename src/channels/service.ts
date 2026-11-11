import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { brands, channels, deliveries } from "@/db/schema";
import { UserError } from "@/domain/errors";

/** Assign a Channel to another Brand. */
export async function moveChannel(db: Db, channelId: string, brandId: string) {
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
  if (!brand) throw new UserError("That Brand no longer exists.");

  // Posts belong to one Brand, so a Channel cannot leave while a Post is still on its way to it.
  const [waiting] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.channelId, channelId),
        inArray(deliveries.status, ["scheduled", "publishing", "needs_attention"]),
      ),
    )
    .limit(1);
  if (waiting) {
    throw new UserError("This Channel has Deliveries that have not finished. Move it once they are done.");
  }

  const [channel] = await db.update(channels).set({ brandId }).where(eq(channels.id, channelId)).returning();
  if (!channel) throw new UserError("That Channel no longer exists.");
  return channel;
}

/** Disconnect a Channel: forget it and its token. Nothing changes on the network. */
export async function disconnectChannel(db: Db, channelId: string) {
  const [delivery] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(eq(deliveries.channelId, channelId))
    .limit(1);
  if (delivery) {
    throw new UserError("This Channel has Posts in the app, so it cannot be disconnected.");
  }
  await db.delete(channels).where(eq(channels.id, channelId));
}
