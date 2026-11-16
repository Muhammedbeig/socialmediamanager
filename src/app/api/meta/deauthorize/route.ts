import { NextResponse } from "next/server";

// Meta calls this when someone removes the app from their Facebook, Instagram or Threads account
// ("Uninstall Callback URL" in the Meta app). The app runs on this laptop only, so Meta cannot reach
// it; the address exists so the field can be filled in. A removed login shows up as "Reconnect
// needed" on the Channels screen the next time it is used.
export async function POST() {
  return NextResponse.json({ ok: true });
}
