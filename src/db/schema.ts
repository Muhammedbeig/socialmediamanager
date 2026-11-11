import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Terms follow GLOSSARY.md: Member, Brand, Channel, Connector, Post, Delivery.

export const NETWORKS = [
  "facebook",
  "instagram",
  "threads",
  "linkedin",
  "youtube",
  "tiktok",
  "pinterest",
  "x",
  // Used by tests only; never offered in the Channels screen.
  "fake",
] as const;
export type Network = (typeof NETWORKS)[number];

export const memberRole = pgEnum("member_role", ["admin", "editor"]);
export const connectorKind = pgEnum("connector_kind", ["api", "browser"]);
export const channelStatus = pgEnum("channel_status", ["connected", "reconnect_needed"]);
export const mediaKind = pgEnum("media_kind", ["image", "video"]);
export const deliveryStatus = pgEnum("delivery_status", [
  "scheduled",
  "publishing",
  "published",
  "failed",
  "needs_attention",
  "removed",
]);
export type DeliveryStatus = (typeof deliveryStatus.enumValues)[number];

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const members = pgTable("members", {
  id: id(),
  name: text("name").notNull(),
  role: memberRole("role").notNull().default("admin"),
  createdAt: createdAt(),
});

export const brands = pgTable("brands", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export type CropRect = { x: number; y: number; width: number; height: number };

export const channels = pgTable(
  "channels",
  {
    id: id(),
    // A Brand can have several Channels on the same network, so (brand, network) is not unique.
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    network: text("network").$type<Network>().notNull(),
    connectorKind: connectorKind("connector_kind").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    // The profile or Page ID on the network.
    externalId: text("external_id").notNull(),
    // Encrypted at rest; the key lives in Windows Credential Manager.
    tokenEncrypted: text("token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: channelStatus("status").notNull().default("connected"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("channels_brand_idx").on(t.brandId),
    // One profile or Page is one Channel.
    uniqueIndex("channels_network_external_idx").on(t.network, t.externalId),
  ],
);

export const mediaAssets = pgTable("media_assets", {
  id: id(),
  kind: mediaKind("kind").notNull(),
  originalName: text("original_name").notNull(),
  // Relative to the data directory.
  path: text("path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  sha256: text("sha256").notNull(),
  createdAt: createdAt(),
});

// A converted or cropped copy of an asset, made for a network's rules.
export const mediaVariants = pgTable(
  "media_variants",
  {
    id: id(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    // Describes the conversion, such as "jpeg|max8MB|crop:0,120,1080,1350". Same spec, same file.
    spec: text("spec").notNull(),
    path: text("path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("media_variants_asset_spec_idx").on(t.assetId, t.spec)],
);

export const posts = pgTable(
  "posts",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    caption: text("caption").notNull().default(""),
    // Null means "publish now".
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => members.id),
    duplicatedFrom: uuid("duplicated_from").references((): AnyPgColumn => posts.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("posts_brand_idx").on(t.brandId)],
);

export const postMedia = pgTable(
  "post_media",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.position] })],
);

export type RemovalResult = {
  ok: boolean;
  permanent?: boolean;
  note?: string;
  error?: string;
  at: string;
};

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "restrict" }),
    captionOverride: text("caption_override"),
    // Extra network fields, such as a YouTube title or a Pinterest board.
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull().default({}),
    // Crops the Member approved in the preview, keyed by media asset ID.
    approvedCrops: jsonb("approved_crops").$type<Record<string, CropRect>>().notNull().default({}),
    status: deliveryStatus("status").notNull().default("scheduled"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalPostId: text("external_post_id"),
    liveUrl: text("live_url"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // Connector bookkeeping between attempts, such as an Instagram container ID.
    networkState: jsonb("network_state").$type<Record<string, unknown>>().notNull().default({}),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removalResult: jsonb("removal_result").$type<RemovalResult>(),
    // Replace: the old Delivery is marked superseded and the new one points back at it.
    superseded: boolean("superseded").notNull().default(false),
    replacesDeliveryId: uuid("replaces_delivery_id").references((): AnyPgColumn => deliveries.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("deliveries_post_idx").on(t.postId),
    index("deliveries_status_idx").on(t.status),
    // One current Delivery per Post and Channel.
    uniqueIndex("deliveries_post_channel_current_idx")
      .on(t.postId, t.channelId)
      .where(sql`${t.superseded} = false`),
  ],
);

// Append-only history of what happened to a Delivery: attempts, Edits, Removals.
export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: id(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("delivery_events_delivery_idx").on(t.deliveryId)],
);

// Feeds the in-app badge; each row also raised a Windows desktop notification.
export const notifications = pgTable("notifications", {
  id: id(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  deliveryId: uuid("delivery_id").references(() => deliveries.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
