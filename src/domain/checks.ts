import type { Capabilities, PostFormat } from "@/connectors/types";
import type { CropRect, TrimRange } from "@/db/schema";

// Pre-publish checks. The composer runs these while the Member writes, and the server runs
// them again before a Post is saved. Every rule comes from the Connector's capabilities.

export type DraftMedia = {
  assetId: string;
  kind: "image" | "video";
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

/** What one Channel would receive: the caption after any override, and that Channel's crops and trims. */
export type Draft = {
  caption: string;
  media: DraftMedia[];
  approvedCrops: Record<string, CropRect>;
  approvedTrims?: Record<string, TrimRange>;
};

export type Issue =
  /** The Channel cannot take this Post as it is. */
  | { kind: "block"; message: string; assetId?: string }
  /** Fixed automatically at publish time: format, codec or file size. */
  | { kind: "convert"; message: string; assetId: string }
  /** The picture must be cropped, which needs the Member's approval of a preview. */
  | { kind: "crop"; message: string; assetId: string; minAspect: number; maxAspect: number; approved: boolean }
  /** The video must be trimmed, which needs the Member's approval of a preview. */
  | {
      kind: "trim";
      message: string;
      assetId: string;
      minSeconds: number;
      maxSeconds: number;
      approved: boolean;
    };

const ASPECT_TOLERANCE = 0.01;

/** Characters as a person counts them: an emoji is one, not two. */
export function countChars(text: string): number {
  return [...text].length;
}

const EMOJI_PART = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]/u;

/** A caption's length the way this network counts it. */
export function captionLength(text: string, rules: Capabilities["caption"]): number {
  if (!rules.emojiAsBytes) return countChars(text);
  // Runs in the browser too, so TextEncoder rather than Buffer.
  const encoder = new TextEncoder();
  let length = 0;
  for (const char of text) {
    length += EMOJI_PART.test(char) ? encoder.encode(char).length : 1;
  }
  return length;
}

/** v1 formats: text, one image, an image carousel, or one video. Null for any other mix. */
export function postFormat(media: readonly Pick<DraftMedia, "kind">[]): PostFormat | null {
  if (media.length === 0) return "text";
  const videos = media.filter((item) => item.kind === "video").length;
  if (videos === 0) return media.length === 1 ? "image" : "carousel";
  return media.length === 1 ? "video" : null;
}

const FORMAT_PHRASE: Record<PostFormat, string> = {
  text: "text-only Posts",
  image: "single images",
  carousel: "image carousels",
  video: "videos",
};

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

function ratio(aspect: number): string {
  const known: [number, string][] = [
    [1, "1:1"],
    [4 / 5, "4:5"],
    [1.91, "1.91:1"],
    [16 / 9, "16:9"],
    [9 / 16, "9:16"],
    [3 / 4, "3:4"],
    [4 / 3, "4:3"],
  ];
  const match = known.find(([value]) => Math.abs(value - aspect) < 0.005);
  return match ? match[1] : `${Math.round(aspect * 100) / 100}:1`;
}

export function aspectInRange(aspect: number, min?: number, max?: number): boolean {
  if (min !== undefined && aspect < min - ASPECT_TOLERANCE) return false;
  if (max !== undefined && aspect > max + ASPECT_TOLERANCE) return false;
  return true;
}

export function cropIsValid(crop: CropRect, width: number, height: number, min?: number, max?: number): boolean {
  if (crop.width <= 0 || crop.height <= 0 || crop.x < 0 || crop.y < 0) return false;
  if (crop.x + crop.width > width + 1 || crop.y + crop.height > height + 1) return false;
  return aspectInRange(crop.width / crop.height, min, max);
}

export function trimIsValid(trim: TrimRange, durationMs: number, minSeconds = 0, maxSeconds = Infinity): boolean {
  if (trim.startMs < 0 || trim.endMs > durationMs + 50 || trim.endMs <= trim.startMs) return false;
  const seconds = (trim.endMs - trim.startMs) / 1000;
  return seconds >= minSeconds && seconds <= maxSeconds + 0.05;
}

/** The trim offered first: from the start, as long as the network allows. */
export function defaultTrim(durationMs: number, maxSeconds: number): TrimRange {
  return { startMs: 0, endMs: Math.min(durationMs, Math.floor(maxSeconds * 1000)) };
}

/** The largest centred crop that fits the allowed shapes. Offered first in the crop preview. */
export function defaultCrop(width: number, height: number, min?: number, max?: number): CropRect {
  const aspect = width / height;
  if (max !== undefined && aspect > max) {
    const cropWidth = Math.floor(height * max);
    return { x: Math.floor((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  if (min !== undefined && aspect < min) {
    const cropHeight = Math.floor(width / min);
    return { x: 0, y: Math.floor((height - cropHeight) / 2), width, height: cropHeight };
  }
  return { x: 0, y: 0, width, height };
}

export function checkPost(draft: Draft, capabilities: Capabilities, network: string): Issue[] {
  const issues: Issue[] = [];
  const format = postFormat(draft.media);

  if (format === null) {
    issues.push({ kind: "block", message: "A Post can hold one video, or one or more images, but not a mix." });
    return issues;
  }
  if (!capabilities.formats.includes(format)) {
    issues.push({ kind: "block", message: `${network} does not take ${FORMAT_PHRASE[format]}.` });
    return issues;
  }

  const length = captionLength(draft.caption, capabilities.caption);
  if (format === "text" && draft.caption.trim().length === 0) {
    issues.push({ kind: "block", message: "Write a caption or add media." });
  }
  if (length > capabilities.caption.maxChars) {
    issues.push({
      kind: "block",
      message: `${network} takes captions up to ${capabilities.caption.maxChars.toLocaleString("en")} characters; this one has ${length.toLocaleString("en")}.`,
    });
  }
  const hashtagLimit = capabilities.caption.maxHashtags;
  if (hashtagLimit !== undefined) {
    const hashtags = draft.caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (hashtags > hashtagLimit) {
      issues.push({
        kind: "block",
        message: `${network} takes up to ${hashtagLimit} hashtags; this caption has ${hashtags}.`,
      });
    }
  }

  if (format === "carousel" && capabilities.carousel) {
    const { min, max } = capabilities.carousel;
    if (draft.media.length < min || draft.media.length > max) {
      issues.push({
        kind: "block",
        message: `${network} carousels take ${min} to ${max} images; this Post has ${draft.media.length}.`,
      });
    }
  }

  for (const item of draft.media) {
    if (item.kind === "image") issues.push(...checkImage(item, draft, capabilities, network));
    else issues.push(...checkVideo(item, draft, capabilities, network));
  }
  return issues;
}

function checkImage(item: DraftMedia, draft: Draft, capabilities: Capabilities, network: string): Issue[] {
  const rules = capabilities.image;
  if (!rules) return [{ kind: "block", assetId: item.assetId, message: `${network} does not take images.` }];
  const issues: Issue[] = [];

  if (!rules.mimeTypes.includes(item.mimeType)) {
    const target = rules.convertTo === "image/jpeg" ? "JPEG" : "PNG";
    issues.push({ kind: "convert", assetId: item.assetId, message: `Will be converted to ${target} for ${network}.` });
  } else if (item.sizeBytes > rules.maxBytes) {
    issues.push({
      kind: "convert",
      assetId: item.assetId,
      message: `Will be compressed to fit ${network}'s ${megabytes(rules.maxBytes)} limit.`,
    });
  }

  if (item.width && item.height && !aspectInRange(item.width / item.height, rules.minAspect, rules.maxAspect)) {
    const crop = draft.approvedCrops[item.assetId];
    const approved = crop ? cropIsValid(crop, item.width, item.height, rules.minAspect, rules.maxAspect) : false;
    const shapes =
      rules.minAspect !== undefined && rules.maxAspect !== undefined
        ? `between ${ratio(rules.minAspect)} and ${ratio(rules.maxAspect)}`
        : rules.maxAspect !== undefined
          ? `no wider than ${ratio(rules.maxAspect)}`
          : `no taller than ${ratio(rules.minAspect ?? 1)}`;
    issues.push({
      kind: "crop",
      assetId: item.assetId,
      minAspect: rules.minAspect ?? 0,
      maxAspect: rules.maxAspect ?? Number.POSITIVE_INFINITY,
      approved,
      message: `${network} takes images ${shapes}. This one needs a crop.`,
    });
  }
  return issues;
}

function checkVideo(item: DraftMedia, draft: Draft, capabilities: Capabilities, network: string): Issue[] {
  const rules = capabilities.video;
  if (!rules) return [{ kind: "block", assetId: item.assetId, message: `${network} does not take videos.` }];
  const issues: Issue[] = [];
  const seconds = item.durationMs === null ? null : item.durationMs / 1000;

  // Too long: the Member trims it in a preview. Never cut silently.
  if (seconds !== null && rules.maxSeconds !== undefined && seconds > rules.maxSeconds) {
    const trim = draft.approvedTrims?.[item.assetId];
    issues.push({
      kind: "trim",
      assetId: item.assetId,
      minSeconds: rules.minSeconds ?? 0,
      maxSeconds: rules.maxSeconds,
      approved: trim ? trimIsValid(trim, item.durationMs!, rules.minSeconds, rules.maxSeconds) : false,
      message: `${network} takes videos up to ${rules.maxSeconds} seconds; this one runs ${Math.round(seconds)}. It needs a trim.`,
    });
  }
  // Too short or the wrong shape cannot be fixed by cutting, so the Member picks another file.
  if (seconds !== null && rules.minSeconds !== undefined && seconds < rules.minSeconds) {
    issues.push({
      kind: "block",
      assetId: item.assetId,
      message: `${network} takes videos of at least ${rules.minSeconds} seconds; this one runs ${Math.round(seconds * 10) / 10}.`,
    });
  }
  if (item.width && item.height && !aspectInRange(item.width / item.height, rules.minAspect, rules.maxAspect)) {
    issues.push({
      kind: "block",
      assetId: item.assetId,
      message: `${network} does not take videos in this shape (${item.width}×${item.height}).`,
    });
  }

  if (!rules.mimeTypes.includes(item.mimeType)) {
    issues.push({ kind: "convert", assetId: item.assetId, message: `Will be converted to MP4 for ${network}.` });
  } else if (item.sizeBytes > rules.maxBytes) {
    issues.push({
      kind: "convert",
      assetId: item.assetId,
      message: `Will be compressed to fit ${network}'s ${megabytes(rules.maxBytes)} limit.`,
    });
  }
  return issues;
}

/** True when nothing blocks the Post and every needed crop and trim has been approved. */
export function canPublish(issues: readonly Issue[]): boolean {
  return issues.every(
    (issue) => issue.kind === "convert" || ((issue.kind === "crop" || issue.kind === "trim") && issue.approved),
  );
}
