import { type NextRequest, NextResponse } from "next/server";
import { CONNECT_COOKIE, appUrl, channelsRedirect } from "@/channels/http";
import { beginConnect } from "@/channels/connect";
import { entryKey, getNetwork, missingEnv } from "@/connectors/registry";

// Starts connecting a Channel: remembers the Brand, then sends the Member to the network's login.
export async function GET(request: NextRequest, context: { params: Promise<{ network: string }> }) {
  const { network } = await context.params;
  const base = appUrl();

  // The login comes back to APP_URL. Start there too, so the cookie set here is still visible.
  if (request.nextUrl.host !== new URL(base).host) {
    return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, base));
  }

  const entry = getNetwork(network);
  const brandId = request.nextUrl.searchParams.get("brandId");
  if (!entry) return channelsRedirect({ error: "That network cannot be connected." });
  if (!brandId) return channelsRedirect({ error: "Choose a Brand first." });
  const missing = missingEnv(entry);
  if (missing.length > 0) {
    return channelsRedirect({ error: `Add ${missing.join(" and ")} to .env.local first (see docs/setup.md).` });
  }

  const { url, state } = beginConnect(entry, base);
  const response = NextResponse.redirect(url);
  response.cookies.set(CONNECT_COOKIE, JSON.stringify({ state, network: entryKey(entry), brandId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    path: "/api/channels",
    maxAge: 600,
  });
  return response;
}
