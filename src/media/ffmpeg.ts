import { execFile } from "node:child_process";
import path from "node:path";

/** Where original media, converted copies and thumbnails live on the laptop. */
// turbopackIgnore: these paths point at runtime data, not code the build should trace.
export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? "data");
}

export function dataPath(relative: string): string {
  return path.join(/* turbopackIgnore: true */ dataDir(), relative);
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
        reject(new Error(`${command} failed: ${detail || error.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function ffmpeg(args: string[]): Promise<string> {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

export function ffprobe(args: string[]): Promise<string> {
  return run("ffprobe", ["-v", "error", ...args]);
}
