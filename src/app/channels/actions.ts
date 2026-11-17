"use server";

import { field, runFormAction } from "@/app/form-action";
import { addBrowserChannel, forgetBrowserProfile, requestLogin, setPremium } from "@/channels/browser";
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
    const channelId = field(formData, "channelId");
    await disconnectChannel(getDb(), channelId);
    // A browser Channel's saved login is forgotten too.
    await forgetBrowserProfile(channelId);
    return "Channel disconnected.";
  });
}

export async function addBrowserChannelAction(formData: FormData) {
  await runFormAction("/channels", async () => {
    const channel = await addBrowserChannel(getDb(), {
      brandId: field(formData, "brandId"),
      network: field(formData, "network"),
      displayName: field(formData, "displayName"),
      handle: field(formData, "handle"),
    });
    return `${channel.displayName} added. A Chrome window opens within a few seconds: log in there, then close it.`;
  });
}

export async function loginAgainAction(formData: FormData) {
  await runFormAction("/channels", async () => {
    const channel = await requestLogin(getDb(), field(formData, "channelId"));
    return `A Chrome window for ${channel.displayName} opens within a few seconds: log in there, then close it.`;
  });
}

export async function setPremiumAction(formData: FormData) {
  await runFormAction("/channels", async () => {
    const premium = field(formData, "premium") === "on";
    const channel = await setPremium(getDb(), field(formData, "channelId"), premium);
    return `${channel.displayName}: Premium ${premium ? "on" : "off"}.`;
  });
}
