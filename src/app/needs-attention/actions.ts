"use server";

import { field, runFormAction } from "@/app/form-action";
import { getDb } from "@/db/client";
import { requestBringForward } from "@/settings/values";

export async function bringForwardAction(formData: FormData) {
  await runFormAction("/needs-attention", async () => {
    await requestBringForward(getDb(), field(formData, "channelId"));
    return "The window comes to the front within a few seconds.";
  });
}
