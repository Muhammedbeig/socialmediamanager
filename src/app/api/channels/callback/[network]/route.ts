import type { NextRequest } from "next/server";
import { CONNECT_COOKIE, appUrl, channelsRedirect } from "@/channels/http";
import { completeConnect } from "@/channels/connect";
import { getNetwork } from "@/connectors/registry";
import { ConnectorError } from "@/connectors/types";
import { getDb } from "@/db/client";

// The network's login sends the Member back here with a code.
export async function GET(request: NextRequest, context: { params: Promise<{ network: string }> }) {
  const { network } = await context.params;
  const query = request.nextUrl.searchParams;

  const finish = (params: Parameters<typeof channelsRedirect>[0]) => {
    const response = channelsRedirect(params);
    response.cookies.delete({ name: CONNECT_COOKIE, path: "/api/channels" });
    return response;
  };

  let pending: { state?: string; network?: string; brandId?: string } = {};
  try {
    pending = JSON.parse(request.cookies.get(CONNECT_COOKIE)?.value ?? "{}");
  } catch {
    // Treated as a missing cookie below.
  }

  const entry = getNetwork(network);
  if (!entry) return finish({ error: "That network cannot be connected." });

  if (query.get("error")) {
    const reason = query.get("error_description") ?? query.get("error_reason") ?? query.get("error");
    return finish({ error: `${entry.name} did not connect: ${reason}` });
  }

  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state || !pending.brandId || pending.state !== state || pending.network !== entry.network) {
    return finish({ error: "That login could not be matched to a connect request. Try connecting again." });
  }

  try {
    const result = await completeConnect(getDb(), entry, {
      brandId: pending.brandId,
      code,
      appUrl: appUrl(),
    });
    if (result.connected.length + result.reconnected.length === 0) {
      return finish({
        error: `${entry.name} login worked, but it granted no ${entry.channelNoun} to publish to.`,
      });
    }
    return finish({ connected: result.connected, reconnected: result.reconnected });
  } catch (error) {
    const message = error instanceof ConnectorError || error instanceof Error ? error.message : "Unknown error";
    return finish({ error: `${entry.name} did not connect: ${message}` });
  }
}
