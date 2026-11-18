import type { Network } from "@/db/schema";

// A Connector is the way a Channel's network is reached. Network rules live only here:
// the composer and Post detail read `capabilities()` and never hard-code a network's limits.

export type PostFormat = "text" | "image" | "carousel" | "video";

export type ImageRules = {
  /** Types the network takes as they are. Anything else is converted to `convertTo`. */
  mimeTypes: string[];
  convertTo: "image/jpeg" | "image/png";
  maxBytes: number;
  /** Width divided by height. Outside this range the Member must approve a crop. */
  minAspect?: number;
  maxAspect?: number;
  maxWidth?: number;
};

export type VideoRules = {
  mimeTypes: string[];
  maxBytes: number;
  /** Smaller files are refused, such as LinkedIn's 75 KB floor. Only another file can fix it. */
  minBytes?: number;
  minSeconds?: number;
  maxSeconds?: number;
  minAspect?: number;
  maxAspect?: number;
};

/** An extra field the composer asks for on one network, such as a YouTube title or a Pinterest board. */
export type FieldSpec = {
  key: string;
  label: string;
  kind: "text" | "select";
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
  defaultValue?: string;
  /** Shown under the field. */
  help?: string;
};

export type Capabilities = {
  formats: PostFormat[];
  /** Extra fields the composer shows for Channels on this network. */
  fields?: FieldSpec[];
  caption: {
    maxChars: number;
    maxHashtags?: number;
    /** Threads counts an emoji as its UTF-8 byte length (🎉 is 4), not as one character. */
    emojiAsBytes?: boolean;
  };
  carousel?: { min: number; max: number };
  image?: ImageRules;
  video?: VideoRules;
  /** True when the network downloads media from a public URL (Instagram, Threads). */
  fetchesMediaFromPublicUrl: boolean;
  /** Edit changes text only. `note` is shown where Edit is offered or refused. */
  edit: { text: boolean; note: string };
  /** `note` is shown in the Removal confirmation. */
  removal: { permanent: boolean; note: string };
};

/**
 * How a browser Connector hands a login check, code or CAPTCHA to the Member: the Delivery moves
 * to Needs attention, the Member is notified, and the Connector waits until the check is gone.
 */
export type AttentionHooks = {
  needed(reason: string): Promise<void>;
  resolved(): Promise<void>;
  /** True once each time the Member asked (from the app) to bring this Channel's window forward. */
  bringForwardRequested(): Promise<boolean>;
};

/** What a Connector needs to act as one Channel. The token arrives already decrypted. */
export type ChannelAccess = {
  channelId: string;
  externalId: string;
  /** The profile's @handle, when known. Browser Connectors build post links from it. */
  handle?: string | null;
  /** Empty for browser Channels, which log in through their own browser profile. */
  accessToken: string;
  settings: Record<string, unknown>;
  /** Set for browser Connectors. */
  attention?: AttentionHooks;
  /** Where a browser Connector saves a screenshot when a page has changed. */
  screenshotName?: string;
};

export type PreparedMedia = {
  kind: "image" | "video";
  /** Absolute path of the file to send, already converted and cropped. */
  path: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** Set when the Connector fetches media from a public URL. */
  publicUrl?: string;
};

export type PublishInput = {
  format: PostFormat;
  caption: string;
  media: PreparedMedia[];
  fields: Record<string, unknown>;
  /** Bookkeeping saved by an earlier attempt of this Delivery, such as a container ID. */
  state: Record<string, unknown>;
  /** Save bookkeeping now, so a later attempt can pick up instead of publishing twice. */
  saveState(state: Record<string, unknown>): Promise<void>;
};

export type PublishResult = {
  externalPostId: string;
  liveUrl: string | null;
};

export type LiveDelivery = {
  externalPostId: string;
  state: Record<string, unknown>;
};

export type RemovalOutcome = {
  /** False when the network keeps the post recoverable for a while, such as Facebook's trash. */
  permanent: boolean;
  note?: string;
};

/** A profile or Page that a login grant can publish to. Each becomes one Channel. */
export type ChannelTarget = {
  externalId: string;
  displayName: string;
  handle: string | null;
  accessToken: string;
  expiresAt: Date | null;
};

export type ConnectorAuth = {
  /** Where to send the Member to log in on the network. */
  authorizeUrl(params: { redirectUri: string; state: string }): string;
  /** Trade the code from the redirect for the Channels this login can publish to. */
  exchangeCode(params: { code: string; redirectUri: string }): Promise<ChannelTarget[]>;
  /** Extend a token before it expires. Absent when tokens do not expire. */
  refresh?(accessToken: string): Promise<{ accessToken: string; expiresAt: Date | null }>;
};

export interface Connector {
  readonly network: Network;
  readonly kind: "api" | "browser";
  /** Shown in the Channels screen, such as "Facebook Page". */
  readonly label: string;
  /** Static rules, used before a Channel exists and as the base for `capabilities`. */
  readonly baseCapabilities: Capabilities;
  /** Rules for one Channel. May read live limits from the network. */
  capabilities(access: ChannelAccess): Promise<Capabilities>;
  /** How API Channels log in. Browser Channels log in in their own browser window instead. */
  readonly auth?: ConnectorAuth;
  /** Browser Connectors: where to log in, and how to tell a session is logged in. */
  readonly site?: import("./browser/engine").SiteChecks;
  publish(access: ChannelAccess, input: PublishInput): Promise<PublishResult>;
  /** Present only when `capabilities.edit.text` is true. */
  editText?(access: ChannelAccess, live: LiveDelivery, text: string): Promise<void>;
  remove(access: ChannelAccess, live: LiveDelivery): Promise<RemovalOutcome>;
}

export type ConnectorErrorKind =
  /** Nothing reached the network, or the network said to try later. Safe to retry. */
  | "retryable"
  /** The network refused the content. Retrying the same thing cannot help. */
  | "rejected"
  /** The token is expired or revoked. The Channel needs reconnecting. */
  | "auth"
  /** The request was sent but the answer never came. Never retried automatically. */
  | "outcome_unknown";

export class ConnectorError extends Error {
  /** The network says the post (or other object) does not exist, for example because it was deleted there. */
  readonly notFound: boolean;

  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    options?: { cause?: unknown; notFound?: boolean },
  ) {
    super(message, options);
    this.name = "ConnectorError";
    this.notFound = options?.notFound ?? false;
  }
}
