import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkedinConnector, LINKEDIN_VERSION, littleText } from "@/connectors/linkedin";
import { type ConnectorError, type PreparedMedia, type PublishInput } from "@/connectors/types";
import { youtubeCapabilities, youtubeConnector } from "@/connectors/youtube";
import { checkPost } from "@/domain/checks";

// LinkedIn and YouTube against scripted answers. Nothing reaches a real network.
type Call = { method: string; url: URL; headers: Headers; body: unknown };
type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };
let calls: Call[];
let answers: Answer[];
let dir: string;
let photo: PreparedMedia;
let clip: PreparedMedia;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "social-publisher-slice2-"));
  await writeFile(path.join(dir, "p.jpg"), Buffer.alloc(2048, 1));
  await writeFile(path.join(dir, "v.mp4"), Buffer.alloc(10_000, 2));
  photo = { kind: "image", path: path.join(dir, "p.jpg"), mimeType: "image/jpeg", sizeBytes: 2048, width: 100, height: 100 };
  clip = { kind: "video", path: path.join(dir, "v.mp4"), mimeType: "video/mp4", sizeBytes: 10_000, width: 100, height: 100 };
});
afterAll(() => rm(dir, { recursive: true, force: true }));

beforeEach(() => {
  calls = [];
  answers = [];
  for (const name of ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
    process.env[name] = name.toLowerCase();
  }
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    let body: unknown = init.body;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    calls.push({ method: init.method ?? "GET", url: new URL(String(input)), headers: new Headers(init.headers), body });
    const answer = answers.shift();
    if (!answer) throw new Error(`Unexpected request: ${init.method ?? "GET"} ${String(input)}`);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const noSleep = async () => {};
function input(overrides: Partial<PublishInput> = {}): PublishInput & { saved: Record<string, unknown>[] } {
  const saved: Record<string, unknown>[] = [];
  return {
    format: "text",
    caption: "Hello",
    media: [],
    fields: {},
    state: {},
    saveState: async (state) => {
      saved.push(state);
    },
    saved,
    ...overrides,
  };
}
const paths = () => calls.map((c) => `${c.method} ${c.url.host}${c.url.pathname}`);

describe("LinkedIn Connector", () => {
  const linkedin = createLinkedinConnector({ sleep: noSleep });
  const access = { channelId: "c", externalId: "urn:li:person:abc", accessToken: "TOKEN", settings: {} };

  it("publishes a text post with the versioned headers and returns its link", async () => {
    answers.push({ status: 201, headers: { "x-restli-id": "urn:li:share:123" } });
    const result = await linkedin.publish(access, input({ caption: "Big news (really) #launch" }));
    expect(result).toEqual({ externalPostId: "urn:li:share:123", liveUrl: "https://www.linkedin.com/feed/update/urn:li:share:123/" });
    const call = calls[0];
    expect(call.headers.get("LinkedIn-Version")).toBe(LINKEDIN_VERSION);
    expect(call.headers.get("X-Restli-Protocol-Version")).toBe("2.0.0");
    expect(call.headers.get("Authorization")).toBe("Bearer TOKEN");
    expect(call.body).toMatchObject({ author: "urn:li:person:abc", commentary: "Big news \\(really\\) #launch", lifecycleState: "PUBLISHED" });
  });

  it("uploads photos first and posts them as one multi-image post", async () => {
    answers.push(
      { body: { value: { uploadUrl: "https://www.linkedin.com/dms-uploads/1", image: "urn:li:image:1" } } },
      { status: 201 },
      { body: { value: { uploadUrl: "https://www.linkedin.com/dms-uploads/2", image: "urn:li:image:2" } } },
      { status: 201 },
      { status: 201, headers: { "x-restli-id": "urn:li:share:9" } },
    );
    await linkedin.publish(access, input({ format: "carousel", media: [photo, photo] }));
    expect(paths()).toEqual([
      "POST api.linkedin.com/rest/images",
      "PUT www.linkedin.com/dms-uploads/1",
      "POST api.linkedin.com/rest/images",
      "PUT www.linkedin.com/dms-uploads/2",
      "POST api.linkedin.com/rest/posts",
    ]);
    expect(calls[0].body).toEqual({ initializeUploadRequest: { owner: "urn:li:person:abc" } });
    expect(calls[4].body).toMatchObject({ content: { multiImage: { images: [{ id: "urn:li:image:1" }, { id: "urn:li:image:2" }] } } });
  });

  it("uploads a video in parts, finalizes it with the part ETags, then posts it", async () => {
    answers.push(
      {
        body: {
          value: {
            video: "urn:li:video:V",
            uploadToken: "tok",
            uploadInstructions: [
              { uploadUrl: "https://www.linkedin.com/up/0", firstByte: 0, lastByte: 4999 },
              { uploadUrl: "https://www.linkedin.com/up/1", firstByte: 5000, lastByte: 9999 },
            ],
          },
        },
      },
      { headers: { etag: "e0" } },
      { headers: { etag: "e1" } },
      { body: {} },
      { body: { status: "AVAILABLE" } },
      { status: 201, headers: { "x-restli-id": "urn:li:ugcPost:7" } },
    );
    await linkedin.publish(access, input({ format: "video", media: [clip] }));
    expect((calls[1].body as Blob).size).toBe(5000);
    expect(calls[3].body).toEqual({ finalizeUploadRequest: { video: "urn:li:video:V", uploadToken: "tok", uploadedPartIds: ["e0", "e1"] } });
    expect(calls[5].body).toMatchObject({ content: { media: { id: "urn:li:video:V" } } });
  });

  it("edits the text with a partial update and removes with DELETE", async () => {
    answers.push({ status: 204 }, { status: 204 });
    await linkedin.editText!(access, { externalPostId: "urn:li:share:1", state: {} }, "New words");
    await linkedin.remove(access, { externalPostId: "urn:li:share:1", state: {} });
    expect(calls[0].headers.get("X-RestLi-Method")).toBe("PARTIAL_UPDATE");
    expect(calls[0].url.pathname).toBe("/rest/posts/urn%3Ali%3Ashare%3A1");
    expect(calls[0].body).toEqual({ patch: { $set: { commentary: "New words" } } });
    expect(calls[1].method).toBe("DELETE");
  });

  it("asks a personal app for the member scopes and connects the profile", async () => {
    const url = new URL(linkedin.auth!.authorizeUrl({ redirectUri: "http://localhost:3000/cb", state: "s" }));
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
    answers.push({ body: { access_token: "AT", expires_in: 5_184_000 } }, { body: { sub: "abc", name: "Furquan" } });
    const [target] = await linkedin.auth!.exchangeCode({ code: "c", redirectUri: "http://localhost:3000/cb" });
    expect(target).toMatchObject({ externalId: "urn:li:person:abc", displayName: "Furquan", accessToken: "AT" });
  });

  it("escapes LinkedIn's markup characters but keeps hashtags", () => {
    expect(littleText("Hi @team, see [this] (now) *bold* #tag")).toBe("Hi \\@team, see \\[this\\] \\(now\\) \\*bold\\* #tag");
  });

  it("reports an expired login as needing a reconnect", async () => {
    answers.push({ status: 401, body: { message: "Invalid access token" } });
    const error = (await linkedin.publish(access, input()).catch((e) => e)) as ConnectorError;
    expect(error.kind).toBe("auth");
  });
});

describe("YouTube Connector", () => {
  const access = { channelId: "c", externalId: "UC1", accessToken: JSON.stringify({ r: "REFRESH" }), settings: {} };
  const tokenAnswer = { body: { access_token: "ACCESS", expires_in: 3600 } };

  it("needs a title, and offers the visibility and made-for-kids fields", () => {
    const draft = { caption: "", media: [{ assetId: "v", kind: "video" as const, mimeType: "video/mp4", sizeBytes: 1, width: 1, height: 1, durationMs: 1000 }], approvedCrops: {} };
    expect(checkPost(draft, youtubeCapabilities, "YouTube").map((i) => i.message)).toEqual(["YouTube needs a title."]);
    expect(checkPost({ ...draft, fields: { title: "Launch" } }, youtubeCapabilities, "YouTube")).toEqual([]);
  });

  it("opens a resumable session, saves it, then uploads the file", async () => {
    answers.push(
      tokenAnswer,
      { headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1" } },
      { status: 308 },
      { status: 201, body: { id: "vid123" } },
    );
    const run = input({ format: "video", caption: "Desc", media: [clip], fields: { title: "Launch", privacy: "unlisted" } });
    const result = await youtubeConnector.publish(access, run);

    expect(result).toEqual({ externalPostId: "vid123", liveUrl: "https://www.youtube.com/watch?v=vid123" });
    expect(calls[0].url.href).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1].url.searchParams.get("uploadType")).toBe("resumable");
    expect(calls[1].headers.get("X-Upload-Content-Length")).toBe("10000");
    expect(calls[1].body).toMatchObject({
      snippet: { title: "Launch", description: "Desc" },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    expect(run.saved).toEqual([{ uploadUrl: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1" }]);
    expect(calls[3].headers.get("Content-Range")).toBe("bytes 0-9999/10000");
  });

  it("resumes an interrupted upload from where it stopped, without a second video", async () => {
    answers.push({ status: 308, headers: { range: "bytes=0-5999" } }, { status: 200, body: { id: "vid9" } });
    await youtubeConnector.publish(
      access,
      input({ format: "video", media: [clip], fields: { title: "T" }, state: { uploadUrl: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U2" } }),
    );
    expect(paths()).toEqual([
      "PUT www.googleapis.com/upload/youtube/v3/videos",
      "PUT www.googleapis.com/upload/youtube/v3/videos",
    ]);
    expect(calls[1].headers.get("Content-Range")).toBe("bytes 6000-9999/10000");
    expect((calls[1].body as Blob).size).toBe(4000);
  });

  it("finishes at once when an earlier attempt already uploaded everything", async () => {
    answers.push({ status: 200, body: { id: "done1" } });
    const result = await youtubeConnector.publish(
      access,
      input({ format: "video", media: [clip], fields: { title: "T" }, state: { uploadUrl: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U3" } }),
    );
    expect(result.externalPostId).toBe("done1");
    expect(calls).toHaveLength(1);
  });

  it("edits the description and keeps the title and category", async () => {
    answers.push({ body: { items: [{ id: "v1", snippet: { title: "T", description: "old", categoryId: "22" } }] } }, { body: {} });
    await youtubeConnector.editText!(access, { externalPostId: "v1", state: {} }, "new");
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].body).toEqual({ id: "v1", snippet: { title: "T", description: "new", categoryId: "22" } });
  });

  it("asks a revoked login to be reconnected", async () => {
    const other = { ...access, accessToken: JSON.stringify({ r: "REVOKED" }) };
    answers.push({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    const error = (await youtubeConnector.remove(other, { externalPostId: "v1", state: {} }).catch((e) => e)) as ConnectorError;
    expect(error.kind).toBe("auth");
  });
});
