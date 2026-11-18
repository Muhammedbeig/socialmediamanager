import { openAsBlob } from "node:fs";
import { requireEnv } from "@/env";
import { fieldValue } from "@/domain/checks";
import { apiRequest } from "../http";
import { type Capabilities, type ChannelTarget, type Connector, type ConnectorAuth, ConnectorError } from "../types";

// YouTube Connector: Data API v3, resumable uploads.
// Checked against Google's videos.insert, videos.update and resumable upload docs on 2026-11-16.

const SCOPE = "https://www.googleapis.com/auth/youtube";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

/** A YouTube Channel stores its refresh token; access tokens last an hour and are made as needed. */
type StoredToken = { r: string };

const accessCache = new Map<string, { token: string; until: number }>();

type GoogleToken = { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number };

/** Google ends refresh tokens after 7 days while its app is in Testing (fine for internal use). */
export const TESTING_LOGIN_MS = 7 * 24 * 60 * 60_000;

/**
 * When this login stops working: what Google says, else 7 days while the Google app is in Testing
 * (GOOGLE_APP_PUBLISHED not set), else never.
 */
export function youtubeLoginEnds(answer: Pick<GoogleToken, "refresh_token_expires_in">, now = new Date()): Date | null {
  if (answer.refresh_token_expires_in) return new Date(now.getTime() + answer.refresh_token_expires_in * 1000);
  if (process.env.GOOGLE_APP_PUBLISHED === "1") return null;
  return new Date(now.getTime() + TESTING_LOGIN_MS);
}

async function googleToken(form: Record<string, string>): Promise<GoogleToken> {
  try {
    const { body } = await apiRequest<GoogleToken>("https://oauth2.googleapis.com/token", {
      method: "POST",
      form: { ...form, client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET") },
    });
    return body;
  } catch (error) {
    // A revoked or expired refresh token answers "invalid_grant": the Channel needs reconnecting.
    if (error instanceof ConnectorError && /invalid_grant|expired or revoked/i.test(error.message)) {
      throw new ConnectorError("auth", "The YouTube login has expired or was revoked. Reconnect this Channel.");
    }
    throw error;
  }
}

export async function youtubeAccessToken(stored: string): Promise<string> {
  const { r } = JSON.parse(stored) as StoredToken;
  const cached = accessCache.get(r);
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const answer = await googleToken({ grant_type: "refresh_token", refresh_token: r });
  accessCache.set(r, { token: answer.access_token, until: Date.now() + answer.expires_in * 1000 });
  return answer.access_token;
}

const youtubeAuth: ConnectorAuth = {
  authorizeUrl({ redirectUri, state }) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      // Offline access and a fresh consent make Google return a refresh token every time.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return url.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const answer = await googleToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (!answer.refresh_token) {
      throw new ConnectorError("auth", "Google did not grant offline access. Remove the app's access in your Google account and connect again.");
    }
    const { body } = await apiRequest<{ items?: { id: string; snippet: { title: string; customUrl?: string } }[] }>(
      `${API}/channels?part=snippet&mine=true`,
      { headers: { Authorization: `Bearer ${answer.access_token}` } },
    );
    const stored = JSON.stringify({ r: answer.refresh_token } satisfies StoredToken);
    const expiresAt = youtubeLoginEnds(answer);
    return (body.items ?? []).map(
      (item): ChannelTarget => ({
        externalId: item.id,
        displayName: item.snippet.title,
        handle: item.snippet.customUrl?.replace(/^@/, "") ?? null,
        accessToken: stored,
        expiresAt,
      }),
    );
  },
};

export const youtubeCapabilities: Capabilities = {
  formats: ["video"],
  // The caption becomes the video's description.
  caption: { maxChars: 5000 },
  fields: [
    { key: "title", label: "Title", kind: "text", required: true, maxLength: 100, help: "Shown above the video on YouTube." },
    {
      key: "privacy",
      label: "Visibility",
      kind: "select",
      defaultValue: "public",
      options: [
        { value: "public", label: "Public" },
        { value: "unlisted", label: "Unlisted" },
        { value: "private", label: "Private" },
      ],
    },
    {
      key: "madeForKids",
      label: "Made for kids",
      kind: "select",
      defaultValue: "no",
      options: [
        { value: "no", label: "No" },
        { value: "yes", label: "Yes" },
      ],
      help: "YouTube asks every uploader to say whether a video is made for children.",
    },
  ],
  video: {
    mimeTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"],
    maxBytes: 256 * 1024 * 1024 * 1024,
  },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "YouTube lets the app edit the description of videos it uploaded." },
  removal: { permanent: true, note: "Removal from YouTube is permanent." },
};

function field(values: Record<string, unknown>, key: string): string {
  return fieldValue(values, youtubeCapabilities.fields!.find((spec) => spec.key === key)!);
}

type Video = { id: string; snippet?: { title: string; description?: string; categoryId: string; tags?: string[] } };

/** Sends the file to a resumable session, from where the session says it got to. */
async function sendFile(uploadUrl: string, token: string, path: string, mimeType: string, size: number): Promise<Video> {
  // Ask how much arrived already (nothing for a new session, some or all after an interruption).
  const status = await apiRequest<Video>(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Length": "0", "Content-Range": `bytes */${size}` },
    acceptStatus: [308],
  });
  if (status.status === 200 || status.status === 201) return status.body;
  const range = status.headers.get("range");
  const start = range ? Number(range.split("-")[1]) + 1 : 0;

  const file = await openAsBlob(path);
  const { body } = await apiRequest<Video>(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType, "Content-Range": `bytes ${start}-${size - 1}/${size}` },
    body: file.slice(start),
    timeoutMs: 6 * 60 * 60_000,
  });
  return body;
}

export const youtubeConnector: Connector = {
  network: "youtube",
  kind: "api",
  label: "YouTube channel",
  baseCapabilities: youtubeCapabilities,
  async capabilities() {
    return youtubeCapabilities;
  },
  auth: youtubeAuth,

  async publish(access, input) {
    const token = await youtubeAccessToken(access.accessToken);
    const media = input.media[0];

    // The upload session is saved before any bytes are sent, so a retry resumes it instead of
    // uploading a second video.
    let uploadUrl = typeof input.state.uploadUrl === "string" ? input.state.uploadUrl : null;
    if (!uploadUrl) {
      const session = await apiRequest(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Upload-Content-Length": String(media.sizeBytes),
          "X-Upload-Content-Type": media.mimeType,
        },
        json: {
          snippet: { title: field(input.fields, "title"), description: input.caption, categoryId: "22" },
          status: {
            privacyStatus: field(input.fields, "privacy"),
            selfDeclaredMadeForKids: field(input.fields, "madeForKids") === "yes",
          },
        },
      });
      uploadUrl = session.headers.get("location");
      if (!uploadUrl) throw new ConnectorError("retryable", "YouTube did not open an upload session.");
      await input.saveState({ ...input.state, uploadUrl });
    }

    let video: Video;
    try {
      video = await sendFile(uploadUrl, token, media.path, media.mimeType, media.sizeBytes);
    } catch (error) {
      // An expired session (404) cannot be resumed: start a new one on the next attempt.
      if (error instanceof ConnectorError && /HTTP 404/.test(error.message)) {
        await input.saveState({ ...input.state, uploadUrl: null });
        throw new ConnectorError("retryable", "The YouTube upload session expired; it starts again on the next attempt.");
      }
      throw error;
    }
    return { externalPostId: video.id, liveUrl: `https://www.youtube.com/watch?v=${video.id}` };
  },

  async editText(access, live, text) {
    const token = await youtubeAccessToken(access.accessToken);
    const { body } = await apiRequest<{ items: Video[] }>(`${API}/videos?part=snippet&id=${encodeURIComponent(live.externalPostId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const current = body.items?.[0]?.snippet;
    if (!current) throw new ConnectorError("rejected", "YouTube no longer has this video.");
    // Updating the snippet needs its title and category again.
    await apiRequest(`${API}/videos?part=snippet`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      json: { id: live.externalPostId, snippet: { ...current, description: text } },
    });
  },

  async remove(access, live) {
    const token = await youtubeAccessToken(access.accessToken);
    await apiRequest(`${API}/videos?id=${encodeURIComponent(live.externalPostId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return { permanent: true, note: youtubeCapabilities.removal.note };
  },
};
