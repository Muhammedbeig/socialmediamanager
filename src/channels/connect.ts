import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type NetworkEntry, entryKey } from "@/connectors/registry";
import type { Db } from "@/db/client";
import { brands, channels } from "@/db/schema";
import { encryptToken } from "@/secrets/tokens";

// Connecting a Channel: send the Member to the network's login, then turn each profile or
// Page the login grants into a Channel of the chosen Brand.

export function callbackUrl(appUrl: string, network: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/channels/callback/${network}`;
}

function authOf(entry: NetworkEntry) {
  if (!entry.auth) throw new Error(` Channels log in in their own browser window, not through a login link.`);
  return entry.auth;
}

export function beginConnect(entry: NetworkEntry, appUrl: string) {
  const state = randomBytes(24).toString("base64url");
  const url = authOf(entry).authorizeUrl({ redirectUri: callbackUrl(appUrl, entryKey(entry)), state });
  return { url, state };
}

export type ConnectResult = {
  /** Channels created by this login. */
  connected: string[];
  /** Channels that already existed and got a fresh token. They stay in their Brand. */
  reconnected: string[];
};

export async function completeConnect(
  db: Db,
  entry: NetworkEntry,
  params: { brandId: string; code: string; appUrl: string },
): Promise<ConnectResult> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, params.brandId));
  if (!brand) throw new Error("That Brand no longer exists.");

  const targets = await authOf(entry).exchangeCode({
    code: params.code,
    redirectUri: callbackUrl(params.appUrl, entryKey(entry)),
  });

  const result: ConnectResult = { connected: [], reconnected: [] };
  for (const target of targets) {
    const token = {
      tokenEncrypted: await encryptToken(target.accessToken),
      tokenExpiresAt: target.expiresAt,
      status: "connected" as const,
      displayName: target.displayName,
      handle: target.handle,
    };
    const [existing] = await db
      .select({ id: channels.id, settings: channels.settings })
      .from(channels)
      .where(and(eq(channels.network, entry.network), eq(channels.externalId, target.externalId)));

    if (existing) {
      // A profile reconnected the other way (such as Instagram directly instead of through
      // Facebook) stays the same Channel and switches to that way.
      const settings = { ...existing.settings, ...entry.channelSettings };
      await db.update(channels).set({ ...token, settings }).where(eq(channels.id, existing.id));
      result.reconnected.push(target.displayName);
    } else {
      await db.insert(channels).values({
        ...token,
        settings: { ...entry.channelSettings },
        brandId: brand.id,
        network: entry.network,
        connectorKind: entry.kind,
        externalId: target.externalId,
      });
      result.connected.push(target.displayName);
    }
  }
  return result;
}

/** A Channel needs reconnecting when the network refused its token or the token has run out. */
export function needsReconnect(
  channel: { status: "connected" | "reconnect_needed"; tokenExpiresAt: Date | null },
  now = new Date(),
): boolean {
  if (channel.status === "reconnect_needed") return true;
  return channel.tokenExpiresAt !== null && channel.tokenExpiresAt.getTime() <= now.getTime();
}
