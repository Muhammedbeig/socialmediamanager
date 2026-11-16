import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl } from "@/channels/http";

// Meta's "Delete Callback URL" (data deletion request). Meta expects a status URL and a
// confirmation code in reply. The app keeps data only on this laptop; disconnecting a Channel on
// the Channels screen deletes its stored login.
export async function POST() {
  return NextResponse.json({ url: `${appUrl()}/channels`, confirmation_code: randomUUID() });
}
