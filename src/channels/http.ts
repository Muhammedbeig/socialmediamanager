import { NextResponse } from "next/server";

export const CONNECT_COOKIE = "connect_channel";

/** Where the app is reached in the browser. Network logins redirect back to this address. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Back to the Channels screen with a message to show. */
export function channelsRedirect(params: { error?: string; connected?: string[]; reconnected?: string[] }) {
  const url = new URL("/channels", appUrl());
  if (params.error) url.searchParams.set("error", params.error);
  if (params.connected?.length) url.searchParams.set("connected", params.connected.join(", "));
  if (params.reconnected?.length) url.searchParams.set("reconnected", params.reconnected.join(", "));
  return NextResponse.redirect(url);
}
