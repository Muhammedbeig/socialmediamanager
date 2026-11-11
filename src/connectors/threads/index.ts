import { type ContainerApi, publicUrl, publishThroughContainer } from "../meta/containers";
import { type ContainerStatus, type Sleep, metaRequest, realSleep } from "../meta/http";
import type { Capabilities, Connector } from "../types";
import { THREADS_GRAPH, threadsAuth } from "./auth";

// Threads Connector. Checked against Meta's Threads API docs (posts, media specifications,
// troubleshooting, delete posts) on 2026-11-11.

export const threadsCapabilities: Capabilities = {
  formats: ["text", "image", "carousel", "video"],
  caption: { maxChars: 500, emojiAsBytes: true },
  carousel: { min: 2, max: 20 },
  image: {
    mimeTypes: ["image/jpeg", "image/png"],
    convertTo: "image/jpeg",
    maxBytes: 8 * 1024 * 1024,
    minAspect: 0.1,
    maxAspect: 10,
    maxWidth: 1440,
  },
  video: {
    mimeTypes: ["video/mp4", "video/quicktime"],
    maxBytes: 1024 * 1024 * 1024,
    maxSeconds: 300,
    minAspect: 0.01,
    maxAspect: 10,
  },
  fetchesMediaFromPublicUrl: true,
  edit: {
    text: false,
    note: "Threads does not let apps edit a post. You can Replace it, which loses its likes and replies, or keep it as it is.",
  },
  removal: { permanent: true, note: "Removal from Threads is permanent. Threads allows 100 removals per profile per day." },
};

export function createThreadsConnector(options: { sleep?: Sleep } = {}): Connector {
  const api: ContainerApi = {
    network: "Threads",
    graph: THREADS_GRAPH,
    createPath: "threads",
    publishPath: "threads_publish",
    single(input): Record<string, string> {
      if (input.format === "text") return { media_type: "TEXT", text: input.caption };
      const media = input.media[0];
      return media.kind === "video"
        ? { media_type: "VIDEO", video_url: publicUrl(media, "Threads"), text: input.caption }
        : { media_type: "IMAGE", image_url: publicUrl(media, "Threads"), text: input.caption };
    },
    carouselItem(media): Record<string, string> {
      return media.kind === "video"
        ? { media_type: "VIDEO", is_carousel_item: "true", video_url: publicUrl(media, "Threads") }
        : { media_type: "IMAGE", is_carousel_item: "true", image_url: publicUrl(media, "Threads") };
    },
    carousel(input, children) {
      return { media_type: "CAROUSEL", children: children.join(","), text: input.caption };
    },
    async readStatus(containerId, accessToken) {
      const answer = await metaRequest<{ status: ContainerStatus; error_message?: string }>(
        `${THREADS_GRAPH}/${containerId}?fields=status,error_message`,
        { accessToken },
      );
      return { status: answer.status, message: answer.error_message };
    },
    // Threads suggests about 30 seconds on average before publishing; check every 5.
    intervalMs: 5_000,
    maxWaitMs: 5 * 60_000,
    sleep: options.sleep ?? realSleep,
  };

  return {
    network: "threads",
    kind: "api",
    label: "Threads profile",
    baseCapabilities: threadsCapabilities,
    async capabilities() {
      return threadsCapabilities;
    },
    auth: threadsAuth,
    publish: (access, input) => publishThroughContainer(api, access, input),
    async remove(access, live) {
      await metaRequest(`${THREADS_GRAPH}/${live.externalPostId}`, { method: "DELETE", accessToken: access.accessToken });
      return { permanent: true, note: threadsCapabilities.removal.note };
    },
  };
}

export const threadsConnector = createThreadsConnector();
