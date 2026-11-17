import { FACEBOOK_GRAPH } from "../facebook/auth";
import { type ContainerApi, publicUrl, publishThroughContainer } from "../meta/containers";
import { type ContainerStatus, type Sleep, metaRequest, realSleep } from "../meta/http";
import { type Capabilities, type ChannelAccess, type Connector, ConnectorError } from "../types";
import { instagramAuth } from "./auth";
import { instagramLoginOf } from "./login";

// Instagram Connector, on graph.facebook.com. A Channel connects one of two ways (docs/adr/0008):
// - through Facebook (default): the linked Page's token, with instagram_manage_contents, so it can
//   remove posts.
// - directly with Unified Login: the business's system user token, which has no delete permission,
//   so Removal only marks the Delivery removed and the Member deletes the post in Instagram.
// Checked against Meta's content publishing, IG User media and Instagram Media docs on 2026-11-17.

export const instagramCapabilities: Capabilities = {
  formats: ["image", "carousel", "video"],
  caption: { maxChars: 2200, maxHashtags: 30 },
  carousel: { min: 2, max: 20 },
  image: {
    mimeTypes: ["image/jpeg"],
    convertTo: "image/jpeg",
    maxBytes: 8 * 1024 * 1024,
    minAspect: 4 / 5,
    maxAspect: 1.91,
    maxWidth: 1440,
  },
  // Single videos publish as Reels.
  video: {
    mimeTypes: ["video/mp4", "video/quicktime"],
    maxBytes: 300 * 1024 * 1024,
    minSeconds: 3,
    maxSeconds: 15 * 60,
    minAspect: 0.01,
    maxAspect: 10,
  },
  fetchesMediaFromPublicUrl: true,
  edit: {
    text: false,
    note: "Instagram does not let apps change a caption. You can Replace the post, which loses its likes and comments, or keep it as it is.",
  },
  removal: { permanent: true, note: "Removal from Instagram is permanent." },
};

const MANUAL_REMOVAL_NOTE =
  "This profile connected directly, and Instagram does not let the app remove those posts. " +
  "This only marks it removed here: delete the post yourself in the Instagram app.";

/** Rules for a Channel connected directly with Unified Login. */
export const instagramDirectCapabilities: Capabilities = {
  ...instagramCapabilities,
  removal: { permanent: true, manual: true, note: MANUAL_REMOVAL_NOTE },
};

const isDirect = (access: ChannelAccess) => instagramLoginOf(access.settings) === "direct";

type PublishingLimit = { data?: { quota_usage?: number; config?: { quota_total?: number } }[] };

export function createInstagramConnector(options: { sleep?: Sleep } = {}): Connector {
  const api: ContainerApi = {
    network: "Instagram",
    graph: FACEBOOK_GRAPH,
    createPath: "media",
    publishPath: "media_publish",
    single(input): Record<string, string> {
      const media = input.media[0];
      return media.kind === "video"
        ? { media_type: "REELS", video_url: publicUrl(media, "Instagram"), caption: input.caption }
        : { image_url: publicUrl(media, "Instagram"), caption: input.caption };
    },
    carouselItem(media): Record<string, string> {
      return media.kind === "video"
        ? { media_type: "VIDEO", is_carousel_item: "true", video_url: publicUrl(media, "Instagram") }
        : { is_carousel_item: "true", image_url: publicUrl(media, "Instagram") };
    },
    carousel(input, children) {
      return { media_type: "CAROUSEL", children: children.join(","), caption: input.caption };
    },
    async readStatus(containerId, accessToken) {
      const answer = await metaRequest<{ status_code: ContainerStatus; status?: string }>(
        `${FACEBOOK_GRAPH}/${containerId}?fields=status_code,status`,
        { accessToken },
      );
      return { status: answer.status_code, message: answer.status };
    },
    intervalMs: 10_000,
    maxWaitMs: 5 * 60_000,
    sleep: options.sleep ?? realSleep,
  };

  return {
    network: "instagram",
    kind: "api",
    label: "Instagram profile",
    baseCapabilities: instagramCapabilities,
    async capabilities(access) {
      return isDirect(access) ? instagramDirectCapabilities : instagramCapabilities;
    },
    auth: instagramAuth,
    async publish(access, input) {
      // Instagram allows a set number of API posts per profile per day. Check before uploading.
      const limit = await metaRequest<PublishingLimit>(
        `${FACEBOOK_GRAPH}/${access.externalId}/content_publishing_limit?fields=quota_usage,config`,
        { accessToken: access.accessToken },
      );
      const usage = limit.data?.[0]?.quota_usage;
      const total = limit.data?.[0]?.config?.quota_total;
      if (usage !== undefined && total !== undefined && usage >= total) {
        throw new ConnectorError(
          "rejected",
          `This Instagram profile has used all ${total} API posts allowed in 24 hours. Retry later.`,
        );
      }
      return publishThroughContainer(api, access, input);
    },
    async remove(access, live) {
      // Deleting needs instagram_manage_contents, which Unified Login does not offer.
      if (isDirect(access)) return { permanent: true, note: MANUAL_REMOVAL_NOTE };
      await metaRequest(`${FACEBOOK_GRAPH}/${live.externalPostId}`, { method: "DELETE", accessToken: access.accessToken });
      return { permanent: true, note: instagramCapabilities.removal.note };
    },
  };
}

export const instagramConnector = createInstagramConnector();
