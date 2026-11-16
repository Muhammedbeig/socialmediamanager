import type { Network } from "@/db/schema";
import { facebookConnector } from "./facebook";
import { fakeConnector } from "./fake";
import { instagramConnector } from "./instagram";
import { linkedinConnector } from "./linkedin";
import { youtubeConnector } from "./youtube";
import { pinterestConnector } from "./browser/pinterest";
import { tiktokConnector } from "./browser/tiktok";
import { xConnector } from "./browser/x";
import { threadsConnector } from "./threads";
import type { Capabilities, Connector, ConnectorAuth } from "./types";

// What the Channels screen needs to know about each network that can be connected,
// and which Connector publishes to it.

export type NetworkEntry = {
  network: Network;
  /** The network's name, such as "Instagram". */
  name: string;
  /** What one Channel on it is, such as "Page" or "profile". */
  channelNoun: string;
  kind: "api" | "browser";
  /** API networks log in through OAuth; browser networks log in in the Channel's own window. */
  auth?: ConnectorAuth;
  /** Settings in .env.local that must be filled in before a Channel can connect. */
  requiredEnv: string[];
};

const ENTRIES: NetworkEntry[] = [
  {
    network: "facebook",
    name: "Facebook",
    channelNoun: "Page",
    kind: "api",
    auth: facebookConnector.auth,
    requiredEnv: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  },
  {
    // Instagram connects through Facebook Login (docs/adr/0005).
    network: "instagram",
    name: "Instagram",
    channelNoun: "profile",
    kind: "api",
    auth: instagramConnector.auth,
    requiredEnv: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  },
  {
    network: "threads",
    name: "Threads",
    channelNoun: "profile",
    kind: "api",
    auth: threadsConnector.auth,
    requiredEnv: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  },
  {
    network: "linkedin",
    name: "LinkedIn",
    channelNoun: "profile or Page",
    kind: "api",
    auth: linkedinConnector.auth,
    requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  },
  {
    network: "youtube",
    name: "YouTube",
    channelNoun: "channel",
    kind: "api",
    auth: youtubeConnector.auth,
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  // Browser Connectors (slice 3): no keys; each Channel logs in once in its own Chrome window.
  { network: "tiktok", name: "TikTok", channelNoun: "account", kind: "browser", requiredEnv: [] },
  { network: "pinterest", name: "Pinterest", channelNoun: "account", kind: "browser", requiredEnv: [] },
  { network: "x", name: "X", channelNoun: "account", kind: "browser", requiredEnv: [] },
];

const FAKE_ENTRY: NetworkEntry = {
  network: "fake",
  name: "Fake network",
  channelNoun: "profile",
  kind: "api",
  auth: fakeConnector.auth,
  requiredEnv: [],
};

const CONNECTORS: Partial<Record<Network, Connector>> = {
  facebook: facebookConnector,
  instagram: instagramConnector,
  threads: threadsConnector,
  linkedin: linkedinConnector,
  youtube: youtubeConnector,
  tiktok: tiktokConnector,
  pinterest: pinterestConnector,
  x: xConnector,
};

function fakeEnabled(): boolean {
  return process.env.ENABLE_FAKE_CONNECTOR === "1";
}

export function listNetworks(): NetworkEntry[] {
  return fakeEnabled() ? [...ENTRIES, FAKE_ENTRY] : ENTRIES;
}

export function getNetwork(network: string): NetworkEntry | undefined {
  return listNetworks().find((entry) => entry.network === network);
}

/** A display name for any network, including ones whose Channels can no longer be connected. */
export function networkName(network: Network): string {
  return [...ENTRIES, FAKE_ENTRY].find((entry) => entry.network === network)?.name ?? network;
}

/**
 * The Connector that publishes to a network, or undefined while it is not built.
 * The composer reads its capabilities; the publisher calls publish; Post detail calls edit and remove.
 */
export function getConnector(network: Network): Connector | undefined {
  if (network === "fake") return fakeEnabled() ? fakeConnector : undefined;
  return CONNECTORS[network];
}

/**
 * The rules for one Channel. Most networks have one set; some depend on the Channel's settings,
 * such as X with Premium. Needs no token: no Connector reads the network for this.
 */
export async function channelCapabilities(channel: {
  id: string;
  network: Network;
  externalId: string;
  handle: string | null;
  settings: Record<string, unknown>;
}): Promise<Capabilities | null> {
  const connector = getConnector(channel.network);
  if (!connector) return null;
  return connector.capabilities({
    channelId: channel.id,
    externalId: channel.externalId,
    handle: channel.handle,
    accessToken: "",
    settings: channel.settings,
  });
}

export function missingEnv(entry: NetworkEntry): string[] {
  return entry.requiredEnv.filter((name) => !process.env[name]);
}
