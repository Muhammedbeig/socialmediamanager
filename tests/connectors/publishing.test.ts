import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { facebookConnector } from "@/connectors/facebook";
import { createInstagramConnector } from "@/connectors/instagram";
import { createThreadsConnector, threadsCapabilities } from "@/connectors/threads";
import { ConnectorError, type PreparedMedia, type PublishInput } from "@/connectors/types";
import { captionLength, checkPost } from "@/domain/checks";
import { ffmpeg } from "@/media/ffmpeg";

// The real Connectors against scripted Meta answers. Nothing reaches a real network.
type Call = { method: string; url: URL; form: URLSearchParams | null; multipart: FormData | null };
let calls: Call[];
let answers: { status?: number; body: unknown }[];
let dir: string;
let photo: PreparedMedia;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "social-publisher-connectors-"));
  const file = path.join(dir, "photo.jpg");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc=size=1080x1080:rate=1", "-frames:v", "1", file]);
  photo = { kind: "image", path: file, mimeType: "image/jpeg", sizeBytes: 1, width: 1080, height: 1080 };
});
afterAll(() => rm(dir, { recursive: true, force: true }));

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? "GET",
      url: new URL(String(input)),
      form: init.body instanceof URLSearchParams ? init.body : null,
      multipart: init.body instanceof FormData ? init.body : null,
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`Unexpected request: ${init.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const access = (externalId: string) => ({ channelId: "c1", externalId, accessToken: "TOKEN", settings: {} });

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

const hosted = (url: string): PreparedMedia => ({ ...photo, publicUrl: url });
const noSleep = vi.fn(async () => {});
const paths = () => calls.map((c) => `${c.method} ${c.url.pathname}`);

describe("Facebook Pages Connector", () => {
  it("publishes a text Post as the Page and reads its link", async () => {
    answers.push({ body: { id: "111_222" } }, { body: { permalink_url: "https://www.facebook.com/111/posts/222" } });
    const result = await facebookConnector.publish(access("111"), input({ caption: "Hi there" }));
    expect(result).toEqual({ externalPostId: "111_222", liveUrl: "https://www.facebook.com/111/posts/222" });
    expect(paths()).toEqual(["POST /v27.0/111/feed", "GET /v27.0/111_222"]);
    expect(calls[0].form?.get("message")).toBe("Hi there");
    expect(calls[0].form?.get("access_token")).toBe("TOKEN");
  });

  it("uploads a photo directly, with its caption", async () => {
    answers.push({ body: { id: "photo1", post_id: "111_333" } }, { body: { permalink_url: "/111/posts/333" } });
    const result = await facebookConnector.publish(access("111"), input({ format: "image", caption: "Look", media: [photo] }));
    expect(result).toEqual({ externalPostId: "111_333", liveUrl: "https://www.facebook.com/111/posts/333" });
    const body = calls[0].multipart!;
    expect(body.get("caption")).toBe("Look");
    expect(body.get("published")).toBe("true");
    expect((body.get("source") as File).size).toBeGreaterThan(1000);
  });

  it("publishes several photos as one Post with attached media", async () => {
    answers.push(
      { body: { id: "p1" } },
      { body: { id: "p2" } },
      { body: { id: "111_444" } },
      { body: { permalink_url: "https://www.facebook.com/111/posts/444" } },
    );
    await facebookConnector.publish(access("111"), input({ format: "carousel", caption: "Two", media: [photo, photo] }));
    expect(calls[0].multipart?.get("published")).toBe("false");
    expect(calls[2].form?.get("attached_media[0]")).toBe('{"media_fbid":"p1"}');
    expect(calls[2].form?.get("attached_media[1]")).toBe('{"media_fbid":"p2"}');
    expect(calls[2].form?.get("message")).toBe("Two");
  });

  it("edits the text in place, and a video's description", async () => {
    answers.push({ body: { success: true } }, { body: { success: true } });
    await facebookConnector.editText!(access("111"), { externalPostId: "111_222", state: {} }, "New text");
    await facebookConnector.editText!(access("111"), { externalPostId: "vid9", state: { kind: "video" } }, "New words");
    expect(paths()).toEqual(["POST /v27.0/111_222", "POST /v27.0/vid9"]);
    expect(calls[0].form?.get("message")).toBe("New text");
    expect(calls[1].form?.get("description")).toBe("New words");
  });

  it("removes a Post and says it sits in the trash for 30 days", async () => {
    answers.push({ body: { success: true } });
    const outcome = await facebookConnector.remove(access("111"), { externalPostId: "111_222", state: {} });
    expect(paths()).toEqual(["DELETE /v27.0/111_222"]);
    expect(calls[0].url.searchParams.get("access_token")).toBe("TOKEN");
    expect(outcome).toMatchObject({ permanent: false });
  });

  it("never retries a publish whose answer was lost", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("socket hang up");
    });
    const error = await facebookConnector.publish(access("111"), input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).kind).toBe("outcome_unknown");
  });
});

describe("Instagram Connector", () => {
  const instagram = createInstagramConnector({ sleep: noSleep });
  const quota = { body: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } };

  it("publishes a photo from its public URL in two steps and saves the container first", async () => {
    answers.push(
      quota,
      { body: { id: "container1" } },
      { body: { status_code: "IN_PROGRESS" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "media1" } },
      { body: { permalink: "https://www.instagram.com/p/abc/" } },
    );
    const run = input({ format: "image", caption: "Cap", media: [hosted("https://pub.r2.dev/a.jpg")] });
    const result = await instagram.publish(access("ig1"), run);

    expect(result).toEqual({ externalPostId: "media1", liveUrl: "https://www.instagram.com/p/abc/" });
    expect(paths()).toEqual([
      "GET /v27.0/ig1/content_publishing_limit",
      "POST /v27.0/ig1/media",
      "GET /v27.0/container1",
      "GET /v27.0/container1",
      "POST /v27.0/ig1/media_publish",
      "GET /v27.0/media1",
    ]);
    expect(calls[1].form?.get("image_url")).toBe("https://pub.r2.dev/a.jpg");
    expect(calls[1].form?.get("caption")).toBe("Cap");
    expect(calls[4].form?.get("creation_id")).toBe("container1");
    expect(run.saved).toEqual([{ containerId: "container1" }]);
    expect(noSleep).toHaveBeenCalled();
  });

  it("publishes a single video as a Reel", async () => {
    answers.push(quota, { body: { id: "c2" } }, { body: { status_code: "FINISHED" } }, { body: { id: "m2" } }, { body: {} });
    const video: PreparedMedia = { ...hosted("https://pub.r2.dev/v.mp4"), kind: "video", mimeType: "video/mp4" };
    await instagram.publish(access("ig1"), input({ format: "video", media: [video] }));
    expect(calls[1].form?.get("media_type")).toBe("REELS");
    expect(calls[1].form?.get("video_url")).toBe("https://pub.r2.dev/v.mp4");
  });

  it("builds a carousel from item containers", async () => {
    answers.push(
      quota,
      { body: { id: "i1" } },
      { body: { id: "i2" } },
      { body: { status_code: "FINISHED" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "parent" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "m3" } },
      { body: {} },
    );
    await instagram.publish(
      access("ig1"),
      input({ format: "carousel", caption: "Set", media: [hosted("https://x/1.jpg"), hosted("https://x/2.jpg")] }),
    );
    expect(calls[1].form?.get("is_carousel_item")).toBe("true");
    expect(calls[5].form?.get("media_type")).toBe("CAROUSEL");
    expect(calls[5].form?.get("children")).toBe("i1,i2");
    expect(calls[5].form?.get("caption")).toBe("Set");
  });

  it("reuses a container from an earlier attempt instead of uploading again", async () => {
    answers.push(quota, { body: { status_code: "FINISHED" } }, { body: { status_code: "FINISHED" } }, { body: { id: "m4" } }, { body: {} });
    await instagram.publish(
      access("ig1"),
      input({ format: "image", media: [hosted("https://x/1.jpg")], state: { containerId: "old" } }),
    );
    expect(paths()).not.toContain("POST /v27.0/ig1/media");
    expect(calls.find((c) => c.url.pathname.endsWith("media_publish"))?.form?.get("creation_id")).toBe("old");
  });

  it("stops when an earlier attempt already published the container", async () => {
    answers.push(quota, { body: { status_code: "PUBLISHED" } });
    const error = (await instagram
      .publish(access("ig1"), input({ format: "image", media: [hosted("https://x/1.jpg")], state: { containerId: "old" } }))
      .catch((e) => e as ConnectorError)) as ConnectorError;
    expect(error.kind).toBe("outcome_unknown");
  });

  it("reports media Instagram could not process as refused", async () => {
    answers.push(quota, { body: { id: "c5" } }, { body: { status_code: "ERROR", status: "Unsupported image" } });
    const error = (await instagram
      .publish(access("ig1"), input({ format: "image", media: [hosted("https://x/1.jpg")] }))
      .catch((e) => e as ConnectorError)) as ConnectorError;
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("Unsupported image");
  });

  it("refuses to publish once the 24-hour publishing limit is used up", async () => {
    answers.push({ body: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } });
    const error = (await instagram
      .publish(access("ig1"), input({ format: "image", media: [hosted("https://x/1.jpg")] }))
      .catch((e) => e as ConnectorError)) as ConnectorError;
    expect(error.kind).toBe("rejected");
    expect(error.message).toMatch(/all 100 API posts/);
  });

  it("cannot edit, and removes permanently", async () => {
    expect(instagram.editText).toBeUndefined();
    expect((await instagram.capabilities(access("ig1"))).edit.text).toBe(false);
    answers.push({ body: { success: true } });
    const outcome = await instagram.remove(access("ig1"), { externalPostId: "media1", state: {} });
    expect(paths()).toEqual(["DELETE /v27.0/media1"]);
    expect(outcome.permanent).toBe(true);
  });
});

describe("Instagram Connector, connected directly with Unified login", () => {
  const instagram = createInstagramConnector({ sleep: noSleep });
  const direct = { ...access("ig1"), settings: { login: "direct" } };

  it("publishes the same way, on graph.facebook.com", async () => {
    answers.push(
      { body: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } },
      { body: { id: "container1" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "media1" } },
      { body: {} },
    );
    await instagram.publish(direct, input({ format: "image", media: [hosted("https://x/1.jpg")] }));
    expect(calls.every((c) => c.url.origin === "https://graph.facebook.com")).toBe(true);
    expect(paths()).toContain("POST /v27.0/ig1/media_publish");
  });

  it("cannot remove: Removal only marks it removed and sends nothing to Instagram", async () => {
    const rules = await instagram.capabilities(direct);
    expect(rules.removal.manual).toBe(true);
    expect((await instagram.capabilities(access("ig1"))).removal.manual).toBeUndefined();
    const outcome = await instagram.remove(direct, { externalPostId: "media1", state: {} });
    expect(calls).toHaveLength(0);
    expect(outcome.note).toMatch(/delete the post yourself in the Instagram app/);
  });
});

describe("Threads Connector", () => {
  const threads = createThreadsConnector({ sleep: noSleep });

  it("publishes a text Post", async () => {
    answers.push(
      { body: { id: "tc1" } },
      { body: { status: "FINISHED" } },
      { body: { id: "t1" } },
      { body: { permalink: "https://www.threads.com/@acme/post/abc" } },
    );
    const result = await threads.publish(access("th1"), input({ caption: "Short and sweet" }));
    expect(result).toEqual({ externalPostId: "t1", liveUrl: "https://www.threads.com/@acme/post/abc" });
    expect(paths()).toEqual(["POST /v1.0/th1/threads", "GET /v1.0/tc1", "POST /v1.0/th1/threads_publish", "GET /v1.0/t1"]);
    expect(calls[0].url.host).toBe("graph.threads.com");
    expect(calls[0].form?.get("media_type")).toBe("TEXT");
    expect(calls[0].form?.get("text")).toBe("Short and sweet");
  });

  it("publishes a photo from its public URL", async () => {
    answers.push({ body: { id: "tc2" } }, { body: { status: "FINISHED" } }, { body: { id: "t2" } }, { body: {} });
    await threads.publish(access("th1"), input({ format: "image", caption: "Pic", media: [hosted("https://x/p.jpg")] }));
    expect(calls[0].form?.get("media_type")).toBe("IMAGE");
    expect(calls[0].form?.get("image_url")).toBe("https://x/p.jpg");
  });

  it("counts an emoji as its UTF-8 byte length, as Threads does", () => {
    expect(captionLength("hi 🎉", threadsCapabilities.caption)).toBe(7);
    const caption = "🎉".repeat(126);
    const issues = checkPost({ caption, media: [], approvedCrops: {} }, threadsCapabilities, "Threads");
    expect(issues[0]?.message).toBe("Threads takes captions up to 500 characters; this one has 504.");
  });

  it("removes a Post permanently", async () => {
    answers.push({ body: { success: true, deleted_id: "t1" } });
    const outcome = await threads.remove(access("th1"), { externalPostId: "t1", state: {} });
    expect(paths()).toEqual(["DELETE /v1.0/t1"]);
    expect(outcome.permanent).toBe(true);
  });
});
