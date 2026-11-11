import { UserError } from "@/domain/errors";
import { ffprobe } from "./ffmpeg";

export type Probe = {
  kind: "image" | "video";
  mimeType: string;
  /** As displayed: already swapped when the file carries a 90° rotation. */
  width: number;
  height: number;
  durationMs: number | null;
};

type FfprobeOutput = {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    disposition?: { attached_pic?: number };
    side_data_list?: { rotation?: number }[];
  }[];
};

const IMAGE_CODECS: Record<string, string> = {
  mjpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

/** Reads what a file really is with ffprobe. The file name and browser-reported type are ignored. */
export async function probeFile(filePath: string): Promise<Probe> {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(await ffprobe(["-print_format", "json", "-show_format", "-show_streams", filePath]));
  } catch {
    throw new UserError("This file is not a photo or video the app can read.");
  }

  const stream = parsed.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const formatName = parsed.format?.format_name ?? "";
  if (!stream?.width || !stream.height || !stream.codec_name) {
    throw new UserError("This file is not a photo or video the app can read.");
  }

  const rotation = Math.abs(stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? stream.height : stream.width;
  const height = sideways ? stream.width : stream.height;

  // Still images come through ffprobe's image demuxers ("png_pipe", "image2", "gif", ...).
  const isImage = formatName.endsWith("_pipe") || formatName === "image2" || formatName === "gif";
  if (isImage) {
    const mimeType = IMAGE_CODECS[stream.codec_name];
    if (!mimeType) throw new UserError(`Images of type "${stream.codec_name}" are not supported.`);
    return { kind: "image", mimeType, width, height, durationMs: null };
  }

  const seconds = Number(parsed.format?.duration ?? stream.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UserError("This file is not a photo or video the app can read.");
  }
  let mimeType = "video/x-unknown";
  if (formatName.includes("mp4")) {
    mimeType = parsed.format?.tags?.major_brand?.trim() === "qt" ? "video/quicktime" : "video/mp4";
  } else if (formatName.includes("webm") || formatName.includes("matroska")) {
    mimeType = "video/webm";
  } else if (formatName.includes("avi")) {
    mimeType = "video/x-msvideo";
  }
  return { kind: "video", mimeType, width, height, durationMs: Math.round(seconds * 1000) };
}
