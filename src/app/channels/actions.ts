"use server";

import { field, runFormAction } from "@/app/form-action";
import { disconnectChannel, moveChannel } from "@/channels/service";
import { getDb } from "@/db/client";

export async function moveChannelAction(formData: FormData) {
  await runFormAction("/channels", async () => {
    const channel = await moveChannel(getDb(), field(formData, "channelId"), field(formData, "brandId"));
    return `${channel.displayName} moved.`;
  });
}

export async function disconnectChannelAction(formData: FormData) {
  await runFormAction("/channels", async () => {
    await disconnectChannel(getDb(), field(formData, "channelId"));
    return "Channel disconnected.";
  });
}
