import { describe, expect, it } from "vitest";
import type { Capabilities } from "@/connectors/types";
import {
  type Draft,
  type DraftMedia,
  canPublish,
  checkPost,
  countChars,
  cropIsValid,
  defaultCrop,
  postFormat,
} from "@/domain/checks";

const capabilities: Capabilities = {
  formats: ["text", "image", "carousel", "video"],
  caption: { maxChars: 20, maxHashtags: 2 },
  carousel: { min: 2, max: 3 },
  image: { mimeTypes: ["image/jpeg"], convertTo: "image/jpeg", maxBytes: 1000, minAspect: 0.8, maxAspect: 1.91 },
  video: { mimeTypes: ["video/mp4"], maxBytes: 5000, maxSeconds: 60, minSeconds: 3 },
  fetchesMediaFromPublicUrl: false,
  edit: { text: true, note: "" },
  removal: { permanent: true, note: "" },
};

function image(overrides: Partial<DraftMedia> = {}): DraftMedia {
  return {
    assetId: "img-1",
    kind: "image",
    mimeType: "image/jpeg",
    sizeBytes: 500,
    width: 1000,
    height: 1000,
    durationMs: null,
    ...overrides,
  };
}

function video(overrides: Partial<DraftMedia> = {}): DraftMedia {
  return {
    assetId: "vid-1",
    kind: "video",
    mimeType: "video/mp4",
    sizeBytes: 3000,
    width: 1080,
    height: 1920,
    durationMs: 10_000,
    ...overrides,
  };
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return { caption: "Hello", media: [], approvedCrops: {}, ...overrides };
}

const check = (d: Draft, caps = capabilities) => checkPost(d, caps, "Testnet");

describe("postFormat", () => {
  it("names the four v1 formats and refuses mixes", () => {
    expect(postFormat([])).toBe("text");
    expect(postFormat([image()])).toBe("image");
    expect(postFormat([image(), image()])).toBe("carousel");
    expect(postFormat([video()])).toBe("video");
    expect(postFormat([video(), image()])).toBeNull();
    expect(postFormat([video(), video()])).toBeNull();
  });
});

describe("checkPost", () => {
  it("passes a Post the Channel can take as it is", () => {
    expect(check(draft({ media: [image()] }))).toEqual([]);
    expect(canPublish([])).toBe(true);
  });

  it("blocks a format the Channel does not take, with the reason", () => {
    const issues = check(draft(), { ...capabilities, formats: ["image", "video"] });
    expect(issues).toEqual([{ kind: "block", message: "Testnet does not take text-only Posts." }]);
    expect(canPublish(issues)).toBe(false);
  });

  it("blocks a mix of video and images", () => {
    expect(check(draft({ media: [video(), image()] }))[0].kind).toBe("block");
  });

  it("blocks an empty text Post", () => {
    expect(check(draft({ caption: "  " }))[0].message).toMatch(/Write a caption/);
  });

  it("blocks a caption over the limit and says by how much", () => {
    const [issue] = check(draft({ caption: "x".repeat(25) }));
    expect(issue.kind).toBe("block");
    expect(issue.message).toBe("Testnet takes captions up to 20 characters; this one has 25.");
  });

  it("counts an emoji as one character", () => {
    expect(countChars("hello 🎉")).toBe(7);
    expect(check(draft({ caption: "🎉".repeat(20) }))).toEqual([]);
  });

  it("blocks too many hashtags", () => {
    const [issue] = check(draft({ caption: "#a #b #c" }));
    expect(issue.message).toMatch(/up to 2 hashtags; this caption has 3/);
  });

  it("blocks a carousel with too many images", () => {
    const media = [1, 2, 3, 4].map((n) => image({ assetId: `img-${n}` }));
    expect(check(draft({ media }))[0].message).toBe("Testnet carousels take 2 to 3 images; this Post has 4.");
  });

  it("converts the wrong image type or an oversized file automatically", () => {
    const png = check(draft({ media: [image({ mimeType: "image/png" })] }));
    expect(png).toEqual([{ kind: "convert", assetId: "img-1", message: "Will be converted to JPEG for Testnet." }]);
    const big = check(draft({ media: [image({ sizeBytes: 3 * 1024 * 1024 })] }));
    expect(big[0].kind).toBe("convert");
    expect(canPublish([...png, ...big])).toBe(true);
  });

  it("asks for an approved crop when an image is the wrong shape, and never crops silently", () => {
    const tall = image({ width: 1000, height: 2000 });
    const issues = check(draft({ media: [tall] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "crop", approved: false, minAspect: 0.8, maxAspect: 1.91 });
    expect(canPublish(issues)).toBe(false);
  });

  it("accepts the crop once the Member approved a valid one", () => {
    const tall = image({ width: 1000, height: 2000 });
    const crop = defaultCrop(1000, 2000, 0.8, 1.91);
    const issues = check(draft({ media: [tall], approvedCrops: { "img-1": crop } }));
    expect(issues[0]).toMatchObject({ kind: "crop", approved: true });
    expect(canPublish(issues)).toBe(true);
  });

  it("does not accept an approved crop that is still the wrong shape", () => {
    const tall = image({ width: 1000, height: 2000 });
    const issues = check(draft({ media: [tall], approvedCrops: { "img-1": { x: 0, y: 0, width: 1000, height: 2000 } } }));
    expect(issues[0]).toMatchObject({ kind: "crop", approved: false });
  });

  it("blocks a video that is too long, too short or the wrong type of shape", () => {
    expect(check(draft({ media: [video({ durationMs: 90_000 })] }))[0].message).toMatch(/up to 60 seconds; this one runs 90/);
    expect(check(draft({ media: [video({ durationMs: 1_000 })] }))[0].kind).toBe("block");
    const caps = { ...capabilities, video: { ...capabilities.video!, minAspect: 0.5, maxAspect: 0.6 } };
    expect(check(draft({ media: [video({ width: 1920, height: 1080 })] }), caps)[0].kind).toBe("block");
  });

  it("converts a video in the wrong container automatically", () => {
    const issues = check(draft({ media: [video({ mimeType: "video/quicktime" })] }));
    expect(issues).toEqual([{ kind: "convert", assetId: "vid-1", message: "Will be converted to MP4 for Testnet." }]);
  });
});

describe("defaultCrop", () => {
  it("cuts the height of a tall image, centred", () => {
    expect(defaultCrop(1000, 2000, 0.8, 1.91)).toEqual({ x: 0, y: 375, width: 1000, height: 1250 });
  });
  it("cuts the width of a wide image, centred", () => {
    expect(defaultCrop(4000, 1000, 0.8, 1.91)).toEqual({ x: 1045, y: 0, width: 1910, height: 1000 });
  });
  it("leaves an image that already fits", () => {
    expect(defaultCrop(1000, 1000, 0.8, 1.91)).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });
  it("always produces a crop that passes its own check", () => {
    for (const [w, h] of [[1000, 2000], [4000, 1000], [333, 1777], [5000, 37]]) {
      expect(cropIsValid(defaultCrop(w, h, 0.8, 1.91), w, h, 0.8, 1.91)).toBe(true);
    }
  });
});
