import type { Network } from "@/db/schema";
import { facebookAuth } from "./facebook/auth";
import { fakeConnector } from "./fake";
import { instagramAuth } from "./instagram/auth";
import { threadsAuth } from "./threads/auth";
import type { Connector, ConnectorAuth } from "./types";

// What the Channels screen needs to know about each network that can be connected.
// Publishing for the real networks is added with their Connectors.

export type NetworkEntry = {
  network: Network;
  /** The network's name, such as "Instagram". */
  name: string;
  /** What one Channel on it is, such as "Page" or "profile". */
  channelNoun: string;
  kind: "api" | "browser";
  auth: ConnectorAuth;
  /** Settings in .env.local that must be filled in before a Channel can connect. */
  requiredEnv: string[];
};

const ENTRIES: NetworkEntry[] = [
  {
    network: "facebook",
    name: "Facebook",
    channelNoun: "Page",
    kind: "api",
    auth: facebookAuth,
    requiredEnv: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  },
  {
    network: "instagram",
    name: "Instagram",
    channelNoun: "profile",
    kind: "api",
    auth: instagramAuth,
    requiredEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  },
  {
    network: "threads",
    name: "Threads",
    channelNoun: "profile",
    kind: "api",
    auth: threadsAuth,
    requiredEnv: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  },
];

const FAKE_ENTRY: NetworkEntry = {
  network: "fake",
  name: "Fake network",
  channelNoun: "profile",
  kind: "api",
  auth: fakeConnector.auth,
  requiredEnv: [],
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
 * The composer reads its capabilities; the Delivery worker calls publish, edit and remove.
 */
export function getConnector(network: Network): Connector | undefined {
  if (network === "fake") return fakeEnabled() ? fakeConnector : undefined;
  return undefined;
}

export function missingEnv(entry: NetworkEntry): string[] {
  return entry.requiredEnv.filter((name) => !process.env[name]);
}
