import type { Network } from "@/db/schema";
import { facebookConnector } from "./facebook";
import { fakeConnector } from "./fake";
import { instagramConnector } from "./instagram";
import { instagramDirectAuth } from "./instagram/login";
import { linkedinConnector } from "./linkedin";
import { youtubeConnector } from "./youtube";
import { pinterestConnector } from "./browser/pinterest";
import { tiktokConnector } from "./browser/tiktok";
import { xConnector } from "./browser/x";
import { linkedinPageConnector } from "./browser/linkedin-page";
import { threadsConnector } from "./threads";
import type { Capabilities, Connector, ConnectorAuth } from "./types";

// What the Channels screen needs to know about each network that can be connected,
// and which Connector publishes to it.

export type NetworkEntry = {
  /** Names this way of connecting in URLs. Defaults to `network`; Instagram has two ways. */
  key?: string;
  network: Network;
  /** Button text, when not "Connect {name}". */
  connectLabel?: string;
  /** Saved in the settings of Channels this way connects, such as which login an Instagram Channel uses. */
  channelSettings?: Record<string, unknown>;
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
    // Instagram through Facebook Login (docs/adr/0005): the profile must be linked to a granted Page.
    network: "instagram",
    name: "Instagram",
    connectLabel: "Connect Instagram through Facebook",
    channelSettings: { login: "facebook" },
    channelNoun: "profile linked to a Page",
    kind: "api",
    auth: instagramConnector.auth,
    requiredEnv: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  },
  {
    // Instagram directly with Unified Login (docs/adr/0008): no Page needed, but no Removal.
    key: "instagram-login",
    network: "instagram",
    name: "Instagram",
    connectLabel: "Connect Instagram directly",
    channelSettings: { login: "direct" },
    channelNoun: "Instagram account",
    kind: "api",
    auth: instagramDirectAuth,
    requiredEnv: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "INSTAGRAM_LOGIN_CONFIG_ID"],
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
  // A company Page through its admin screen (docs/adr/0009); the API route needs LinkedIn's approval.
  { network: "linkedin_page", name: "LinkedIn Page", channelNoun: "company Page", kind: "browser", requiredEnv: [] },
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
  linkedin_page: linkedinPageConnector,
};

function fakeEnabled(): boolean {
  return process.env.ENABLE_FAKE_CONNECTOR === "1";
}

export function listNetworks(): NetworkEntry[] {
  return fakeEnabled() ? [...ENTRIES, FAKE_ENTRY] : ENTRIES;
}

/** The key in this way of connecting's URLs. */
export function entryKey(entry: NetworkEntry): string {
  return entry.key ?? entry.network;
}

/** A way of connecting, by its key (usually the network, such as "facebook"). */
export function getNetwork(key: string): NetworkEntry | undefined {
  return listNetworks().find((entry) => entryKey(entry) === key);
}

/**
 * The way a Channel was connected, for reconnecting it and refreshing its login: the entry of its
 * network whose saved settings match the Channel's, else its network's first entry.
 */
export function connectOptionFor(channel: {
  network: Network;
  settings: Record<string, unknown>;
}): NetworkEntry | undefined {
  const options = listNetworks().filter((entry) => entry.network === channel.network);
  return (
    options.find(
      (entry) =>
        entry.channelSettings &&
        Object.entries(entry.channelSettings).every(([name, value]) => channel.settings[name] === value),
    ) ?? options[0]
  );
}

/** The button text for a way of connecting. */
export function connectLabel(entry: NetworkEntry): string {
  return entry.connectLabel ?? `Connect ${entry.name}`;
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
