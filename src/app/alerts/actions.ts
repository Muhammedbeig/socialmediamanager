"use server";

import { revalidatePath } from "next/cache";
import { runFormAction } from "@/app/form-action";
import { getDb } from "@/db/client";
import { markAlertsRead } from "@/notify/queries";

export async function markAllReadAction() {
  // The badge lives in the layout, so every screen refreshes.
  revalidatePath("/", "layout");
  await runFormAction("/alerts", async () => {
    await markAlertsRead(getDb());
  });
}
