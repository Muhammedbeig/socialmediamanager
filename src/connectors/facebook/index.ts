import { openAsBlob } from "node:fs";
import path from "node:path";
import { metaRequest } from "../meta/http";
import {
  type Capabilities,
  type ChannelAccess,
  type Connector,
  ConnectorError,
  type PreparedMedia,
  type PublishInput,
} from "../types";
import { FACEBOOK_GRAPH, facebookAuth } from "./auth";

// Facebook Pages Connector. Files are uploaded directly, so Facebook needs no public URL.
// Checked against Meta's Pages API (posts, photos) and Video API docs on 2026-11-11.

const FACEBOOK_VIDEO_GRAPH = "https://graph-video.facebook.com/v27.0";

export const facebookCapabilities: Capabilities = {
  formats: ["text", "image", "carousel", "video"],
  caption: { maxChars: 63_206 },
  carousel: { min: 2, max: 10 },
  image: {
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff"],
    convertTo: "image/jpeg",
    // Facebook: "Files can not exceed 10MB."
    maxBytes: 10 * 1024 * 1024,
  },
  video: { mimeTypes: ["video/mp4", "video/quicktime"], maxBytes: 1024 * 1024 * 1024 },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "Facebook lets the app edit the text of Posts it published." },
  removal: { permanent: false, note: "Facebook keeps removed posts in the Page's trash for 30 days." },
};

async function fileField(media: PreparedMedia): Promise<Blob> {
  return openAsBlob(media.path, { type: media.mimeType });
}

async function permalink(id: string, accessToken: string): Promise<string | null> {
  try {
    const answer = await metaRequest<{ permalink_url?: string }>(`${FACEBOOK_GRAPH}/${id}?fields=permalink_url`, {
      accessToken,
    });
    const url = answer.permalink_url;
    if (!url) return null;
    return url.startsWith("http") ? url : `https://www.facebook.com${url}`;
  } catch {
    // The post is live even if its link cannot be read.
    return null;
  }
}

async function publish(access: ChannelAccess, input: PublishInput) {
  const page = access.externalId;
  const token = access.accessToken;

  if (input.format === "text") {
    const { id } = await metaRequest<{ id: string }>(`${FACEBOOK_GRAPH}/${page}/feed`, {
      method: "POST",
      form: { message: input.caption },
      accessToken: token,
      onNoAnswer: "outcome_unknown",
    });
    return { externalPostId: id, liveUrl: await permalink(id, token) };
  }

  if (input.format === "image") {
    const form = new FormData();
    form.set("source", await fileField(input.media[0]), path.basename(input.media[0].path));
    form.set("caption", input.caption);
    form.set("published", "true");
    const answer = await metaRequest<{ id: string; post_id?: string }>(`${FACEBOOK_GRAPH}/${page}/photos`, {
      method: "POST",
      multipart: form,
      accessToken: token,
      timeoutMs: 180_000,
      onNoAnswer: "outcome_unknown",
    });
    const id = answer.post_id ?? answer.id;
    return { externalPostId: id, liveUrl: await permalink(id, token) };
  }

  if (input.format === "carousel") {
    // Upload each photo unpublished, then publish one post holding them all. Unpublished photos
    // that never get attached are removed by Facebook after about a day, so retrying is safe.
    const photoIds: string[] = [];
    for (const media of input.media) {
      const form = new FormData();
      form.set("source", await fileField(media), path.basename(media.path));
      form.set("published", "false");
      const { id } = await metaRequest<{ id: string }>(`${FACEBOOK_GRAPH}/${page}/photos`, {
        method: "POST",
        multipart: form,
        accessToken: token,
        timeoutMs: 180_000,
      });
      photoIds.push(id);
    }
    const fields: Record<string, string> = { message: input.caption };
    photoIds.forEach((id, index) => {
      fields[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
    });
    const { id } = await metaRequest<{ id: string }>(`${FACEBOOK_GRAPH}/${page}/feed`, {
      method: "POST",
      form: fields,
      accessToken: token,
      onNoAnswer: "outcome_unknown",
    });
    return { externalPostId: id, liveUrl: await permalink(id, token) };
  }

  // Video: one upload to the Page's videos. Its text is the "description", not the "message".
  const form = new FormData();
  form.set("source", await fileField(input.media[0]), path.basename(input.media[0].path));
  form.set("description", input.caption);
  const { id } = await metaRequest<{ id: string }>(`${FACEBOOK_VIDEO_GRAPH}/${page}/videos`, {
    method: "POST",
    multipart: form,
    accessToken: token,
    timeoutMs: 30 * 60_000,
    onNoAnswer: "outcome_unknown",
  });
  await input.saveState({ ...input.state, kind: "video" });
  return { externalPostId: id, liveUrl: await permalink(id, token) };
}

export const facebookConnector: Connector = {
  network: "facebook",
  kind: "api",
  label: "Facebook Page",
  baseCapabilities: facebookCapabilities,
  async capabilities() {
    return facebookCapabilities;
  },
  auth: facebookAuth,
  publish,
  async editText(access, live, text) {
    // Videos keep their text in "description"; every other post in "message".
    const field = live.state.kind === "video" ? "description" : "message";
    const answer = await metaRequest<{ success?: boolean }>(`${FACEBOOK_GRAPH}/${live.externalPostId}`, {
      method: "POST",
      form: { [field]: text },
      accessToken: access.accessToken,
    });
    if (answer.success === false) throw new ConnectorError("rejected", "Facebook did not accept the edit.");
  },
  async remove(access, live) {
    await metaRequest(`${FACEBOOK_GRAPH}/${live.externalPostId}`, {
      method: "DELETE",
      accessToken: access.accessToken,
    });
    return { permanent: false, note: facebookCapabilities.removal.note };
  },
};
