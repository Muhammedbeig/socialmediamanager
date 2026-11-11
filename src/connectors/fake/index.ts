import { randomUUID } from "node:crypto";
import {
  type Capabilities,
  type Connector,
  ConnectorError,
  type ConnectorErrorKind,
  type PublishInput,
} from "../types";

// A Connector with no network behind it. Tests script its failures; with
// ENABLE_FAKE_CONNECTOR=1 it also appears in the Channels screen for trying the app out.

type FakePost = { id: string; channelExternalId: string; caption: string; mediaCount: number };

class FakeNetwork {
  posts = new Map<string, FakePost>();
  private failures: { on: "publish" | "edit" | "remove"; kind: ConnectorErrorKind; message: string }[] = [];
  /** The Channels a fake login grants. */
  loginTargets = [{ externalId: "fake-1", displayName: "Fake profile", handle: "fake" }];
  /** Tokens handed out by refresh, and whether refresh should fail. */
  refreshCount = 0;
  refreshFails = false;

  /** Make the next call of this type fail. Queue several for several failures in a row. */
  failNext(on: "publish" | "edit" | "remove", kind: ConnectorErrorKind, message = "Scripted failure") {
    this.failures.push({ on, kind, message });
  }

  takeFailure(on: "publish" | "edit" | "remove") {
    const index = this.failures.findIndex((f) => f.on === on);
    if (index === -1) return;
    const [failure] = this.failures.splice(index, 1);
    throw new ConnectorError(failure.kind, failure.message);
  }

  reset() {
    this.posts.clear();
    this.failures = [];
    this.loginTargets = [{ externalId: "fake-1", displayName: "Fake profile", handle: "fake" }];
    this.refreshCount = 0;
    this.refreshFails = false;
  }
}

// One shared instance per process, kept across Next.js dev reloads.
const globalForFake = globalThis as unknown as { __fakeNetwork?: FakeNetwork };
export const fakeNetwork = (globalForFake.__fakeNetwork ??= new FakeNetwork());

const capabilities: Capabilities = {
  formats: ["text", "image", "carousel", "video"],
  caption: { maxChars: 280 },
  carousel: { min: 2, max: 4 },
  image: {
    mimeTypes: ["image/jpeg"],
    convertTo: "image/jpeg",
    maxBytes: 2 * 1024 * 1024,
    minAspect: 4 / 5,
    maxAspect: 1.91,
  },
  video: { mimeTypes: ["video/mp4"], maxBytes: 50 * 1024 * 1024, maxSeconds: 60 },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "The fake network lets text be edited." },
  removal: { permanent: true, note: "Removal from the fake network is permanent." },
};

export const fakeConnector: Connector = {
  network: "fake",
  kind: "api",
  label: "Fake network (testing)",
  baseCapabilities: capabilities,
  async capabilities() {
    return capabilities;
  },

  auth: {
    // No login page: go straight back to the app with a code.
    authorizeUrl({ redirectUri, state }) {
      const url = new URL(redirectUri);
      url.search = new URLSearchParams({ code: "fake-code", state }).toString();
      return url.toString();
    },
    async exchangeCode() {
      return fakeNetwork.loginTargets.map((target) => ({
        ...target,
        accessToken: `fake-token-${target.externalId}`,
        expiresAt: null,
      }));
    },
    async refresh() {
      if (fakeNetwork.refreshFails) throw new ConnectorError("auth", "The fake login was revoked.");
      fakeNetwork.refreshCount++;
      return {
        accessToken: `fake-refreshed-${fakeNetwork.refreshCount}`,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60_000),
      };
    },
  },

  async publish(access, input: PublishInput) {
    fakeNetwork.takeFailure("publish");
    const id = randomUUID();
    fakeNetwork.posts.set(id, {
      id,
      channelExternalId: access.externalId,
      caption: input.caption,
      mediaCount: input.media.length,
    });
    return { externalPostId: id, liveUrl: `https://fake.example/posts/${id}` };
  },

  async editText(_access, live, text) {
    fakeNetwork.takeFailure("edit");
    const post = fakeNetwork.posts.get(live.externalPostId);
    if (!post) throw new ConnectorError("rejected", "The post no longer exists on the fake network.");
    post.caption = text;
  },

  async remove(_access, live) {
    fakeNetwork.takeFailure("remove");
    fakeNetwork.posts.delete(live.externalPostId);
    return { permanent: true };
  },
};
