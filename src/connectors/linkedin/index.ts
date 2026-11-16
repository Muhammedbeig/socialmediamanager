import { openAsBlob } from "node:fs";
import { requireEnv } from "@/env";
import { apiRequest } from "../http";
import { type Sleep, expiresAtFrom, realSleep } from "../meta/http";
import {
  type Capabilities,
  type ChannelAccess,
  type ChannelTarget,
  type Connector,
  type ConnectorAuth,
  ConnectorError,
  type PreparedMedia,
} from "../types";

// LinkedIn Connector: Posts, Images and Videos APIs.
// Checked against LinkedIn's Marketing docs (version 202610) on 2026-11-16.
// Versions are retired about a year after release: bump LINKEDIN_VERSION when LinkedIn says so.

export const LINKEDIN_VERSION = "202610";
const API = "https://api.linkedin.com/rest";

/**
 * Two kinds of app. A personal profile needs the "Share on LinkedIn" and "Sign In with LinkedIn
 * using OpenID Connect" products. Company Pages need the "Community Management API" product,
 * which LinkedIn grants after a review; set LINKEDIN_PAGES=1 for such an app.
 */
function pagesMode(): boolean {
  return process.env.LINKEDIN_PAGES === "1";
}

/** Tokens are stored as the access token, or as JSON when LinkedIn also gave a refresh token. */
type TokenBundle = { a: string; r?: string };
function parseToken(stored: string): TokenBundle {
  if (stored.startsWith("{")) return JSON.parse(stored) as TokenBundle;
  return { a: stored };
}
function packToken(bundle: TokenBundle): string {
  return bundle.r ? JSON.stringify(bundle) : bundle.a;
}

function headers(accessToken: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${parseToken(accessToken).a}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    ...extra,
  };
}

type TokenAnswer = { access_token: string; expires_in?: number; refresh_token?: string };

async function tokenRequest(form: Record<string, string>): Promise<TokenAnswer> {
  const { body } = await apiRequest<TokenAnswer>("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    form: { ...form, client_id: requireEnv("LINKEDIN_CLIENT_ID"), client_secret: requireEnv("LINKEDIN_CLIENT_SECRET") },
  });
  return body;
}

const linkedinAuth: ConnectorAuth = {
  authorizeUrl({ redirectUri, state }) {
    const scopes = pagesMode()
      ? ["w_organization_social", "r_organization_admin"]
      : ["openid", "profile", "w_member_social"];
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: requireEnv("LINKEDIN_CLIENT_ID"),
      redirect_uri: redirectUri,
      state,
      scope: scopes.join(" "),
    }).toString();
    return url.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const answer = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const stored = packToken({ a: answer.access_token, r: answer.refresh_token });
    const expiresAt = expiresAtFrom(answer.expires_in);

    if (!pagesMode()) {
      const { body: me } = await apiRequest<{ sub: string; name?: string; given_name?: string }>(
        "https://api.linkedin.com/v2/userinfo",
        { headers: { Authorization: `Bearer ${answer.access_token}` } },
      );
      return [{ externalId: `urn:li:person:${me.sub}`, displayName: me.name ?? me.given_name ?? "LinkedIn profile", handle: null, accessToken: stored, expiresAt }];
    }

    // Company Pages the Member can post for.
    const { body: acls } = await apiRequest<{ elements: { organization: string; role: string }[] }>(
      `${API}/organizationAcls?q=roleAssignee&state=APPROVED`,
      { headers: headers(answer.access_token) },
    );
    const roles = new Set(["ADMINISTRATOR", "CONTENT_ADMIN", "DIRECT_SPONSORED_CONTENT_POSTER"]);
    const organizations = [...new Set(acls.elements.filter((acl) => roles.has(acl.role)).map((acl) => acl.organization))];
    const targets: ChannelTarget[] = [];
    for (const urn of organizations) {
      const id = urn.split(":").pop()!;
      let name = `LinkedIn Page ${id}`;
      try {
        const { body } = await apiRequest<{ localizedName?: string; vanityName?: string }>(`${API}/organizations/${id}`, {
          headers: headers(answer.access_token),
        });
        name = body.localizedName ?? name;
      } catch {
        // The Page still works without its name.
      }
      targets.push({ externalId: urn, displayName: name, handle: null, accessToken: stored, expiresAt });
    }
    return targets;
  },

  async refresh(accessToken) {
    const bundle = parseToken(accessToken);
    if (!bundle.r) throw new ConnectorError("auth", "LinkedIn gave no refresh token: reconnect this Channel.");
    const answer = await tokenRequest({ grant_type: "refresh_token", refresh_token: bundle.r });
    return {
      accessToken: packToken({ a: answer.access_token, r: answer.refresh_token ?? bundle.r }),
      expiresAt: expiresAtFrom(answer.expires_in),
    };
  },
};

export const linkedinCapabilities: Capabilities = {
  formats: ["text", "image", "carousel", "video"],
  caption: { maxChars: 3000 },
  // LinkedIn calls a post with several images "multiImage"; organic carousels are not supported.
  carousel: { min: 2, max: 20 },
  image: { mimeTypes: ["image/jpeg", "image/png", "image/gif"], convertTo: "image/jpeg", maxBytes: 8 * 1024 * 1024 },
  video: { mimeTypes: ["video/mp4"], maxBytes: 500 * 1024 * 1024, minSeconds: 3, maxSeconds: 30 * 60 },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "LinkedIn lets the app edit the text of posts it published." },
  removal: { permanent: true, note: "Removal from LinkedIn is permanent." },
};

/**
 * LinkedIn's "little" text format treats some characters as markup; escape them so the text
 * shows as written. Hashtags (#word) stay as they are, so LinkedIn turns them into links.
 */
export function littleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (char) => `\\${char}`);
}

async function uploadImage(access: ChannelAccess, media: PreparedMedia): Promise<string> {
  const { body } = await apiRequest<{ value: { uploadUrl: string; image: string } }>(`${API}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(access.accessToken),
    json: { initializeUploadRequest: { owner: access.externalId } },
  });
  await apiRequest(body.value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${parseToken(access.accessToken).a}`, "Content-Type": "application/octet-stream" },
    body: await openAsBlob(media.path),
    timeoutMs: 300_000,
  });
  return body.value.image;
}

async function uploadVideo(access: ChannelAccess, media: PreparedMedia, sleep: Sleep): Promise<string> {
  type Init = {
    value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
  };
  const { body } = await apiRequest<Init>(`${API}/videos?action=initializeUpload`, {
    method: "POST",
    headers: headers(access.accessToken),
    json: {
      initializeUploadRequest: { owner: access.externalId, fileSizeBytes: media.sizeBytes, uploadCaptions: false, uploadThumbnail: false },
    },
  });
  const file = await openAsBlob(media.path);
  const etags: string[] = [];
  for (const part of body.value.uploadInstructions) {
    const { headers: answer } = await apiRequest(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(part.firstByte, part.lastByte + 1),
      timeoutMs: 300_000,
    });
    const etag = answer.get("etag");
    if (!etag) throw new ConnectorError("retryable", "LinkedIn did not confirm a video part.");
    etags.push(etag);
  }
  await apiRequest(`${API}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(access.accessToken),
    json: { finalizeUploadRequest: { video: body.value.video, uploadToken: body.value.uploadToken, uploadedPartIds: etags } },
  });

  // Wait for LinkedIn to process the video. Reading video status needs more than w_member_social,
  // so if LinkedIn refuses the read, post anyway: LinkedIn then publishes once processing ends.
  for (let waited = 0; waited < 10 * 60_000; waited += 10_000) {
    try {
      const { body: video } = await apiRequest<{ status: string; processingFailureReason?: string }>(
        `${API}/videos/${encodeURIComponent(body.value.video)}`,
        { headers: headers(access.accessToken) },
      );
      if (video.status === "AVAILABLE") break;
      if (video.status === "PROCESSING_FAILED") {
        throw new ConnectorError("rejected", `LinkedIn could not process the video${video.processingFailureReason ? `: ${video.processingFailureReason}` : "."}`);
      }
    } catch (error) {
      if (error instanceof ConnectorError && error.kind !== "retryable" && !/403/.test(error.message)) throw error;
      if (error instanceof ConnectorError && /403/.test(error.message)) break;
    }
    await sleep(10_000);
  }
  return body.value.video;
}

export function createLinkedinConnector(options: { sleep?: Sleep } = {}): Connector {
  const sleep = options.sleep ?? realSleep;
  return {
    network: "linkedin",
    kind: "api",
    label: "LinkedIn profile or Page",
    baseCapabilities: linkedinCapabilities,
    async capabilities() {
      return linkedinCapabilities;
    },
    auth: linkedinAuth,

    async publish(access, input) {
      let content: Record<string, unknown> | undefined;
      if (input.format === "image") {
        content = { media: { id: await uploadImage(access, input.media[0]) } };
      } else if (input.format === "carousel") {
        const ids: string[] = [];
        for (const media of input.media) ids.push(await uploadImage(access, media));
        content = { multiImage: { images: ids.map((id) => ({ id })) } };
      } else if (input.format === "video") {
        content = { media: { id: await uploadVideo(access, input.media[0], sleep) } };
      }

      const { headers: answer } = await apiRequest(`${API}/posts`, {
        method: "POST",
        headers: headers(access.accessToken),
        json: {
          author: access.externalId,
          commentary: littleText(input.caption),
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          ...(content ? { content } : {}),
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
        onNoAnswer: "outcome_unknown",
      });
      const urn = answer.get("x-restli-id");
      if (!urn) throw new ConnectorError("outcome_unknown", "LinkedIn accepted the post but did not say which one it is.");
      return { externalPostId: urn, liveUrl: `https://www.linkedin.com/feed/update/${urn}/` };
    },

    async editText(access, live, text) {
      await apiRequest(`${API}/posts/${encodeURIComponent(live.externalPostId)}`, {
        method: "POST",
        headers: headers(access.accessToken, { "X-RestLi-Method": "PARTIAL_UPDATE" }),
        json: { patch: { $set: { commentary: littleText(text) } } },
      });
    },

    async remove(access, live) {
      await apiRequest(`${API}/posts/${encodeURIComponent(live.externalPostId)}`, {
        method: "DELETE",
        headers: headers(access.accessToken, { "X-RestLi-Method": "DELETE" }),
      });
      return { permanent: true, note: linkedinCapabilities.removal.note };
    },
  };
}

export const linkedinConnector = createLinkedinConnector();
