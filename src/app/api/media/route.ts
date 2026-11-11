import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { UserError } from "@/domain/errors";
import { saveUpload } from "@/media/library";
import { toClientAsset } from "@/media/client-asset";

// Upload one file into the media library. The file is the raw request body, so a large video
// streams to disk instead of being held in memory: POST /api/media?name=<file name>
export async function POST(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") ?? "upload";
  if (!request.body) return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  try {
    const asset = await saveUpload(getDb(), { name, body: request.body });
    return NextResponse.json({ asset: toClientAsset(asset) });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Upload failed", error);
    return NextResponse.json({ error: "The upload failed. Try again." }, { status: 500 });
  }
}
