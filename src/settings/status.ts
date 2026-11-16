import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { missingR2Settings } from "@/media/r2";
import { lastHeartbeat, workerRunning } from "./heartbeat";

// The Settings screen's checklist: everything the app needs to publish, and what is missing.

export type SetupItem = {
  id: "database" | "worker" | "ffmpeg" | "chrome" | "meta" | "threads" | "linkedin" | "google" | "r2" | "address" | "startup";
  name: string;
  ok: boolean;
  /** Not needed for every Post, such as Threads when no Threads Channel is wanted. */
  optional?: boolean;
  detail: string;
};

function ffmpegVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) resolve(null);
      else resolve(stdout.split(/\r?\n/)[0]?.replace(/ Copyright.*/, "") ?? "ffmpeg");
    });
  });
}

function missing(names: string[]): string[] {
  return names.filter((name) => !process.env[name]);
}

/** Where Windows installs Google Chrome, for all users or just this one. */
export function chromeInstalled(): boolean {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.some((candidate) => candidate && existsSync(candidate));
}

export function startupShortcutPath(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Social Publisher.lnk");
}

export async function setupStatus(db: Db, now = new Date()): Promise<SetupItem[]> {
  let databaseOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    databaseOk = false;
  }
  const [heartbeat, ffmpeg] = await Promise.all([databaseOk ? lastHeartbeat(db) : null, ffmpegVersion()]);
  const metaMissing = missing(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
  const threadsMissing = missing(["THREADS_APP_ID", "THREADS_APP_SECRET"]);
  const linkedinMissing = missing(["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]);
  const googleMissing = missing(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  const r2Missing = missingR2Settings();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const shortcut = startupShortcutPath();

  return [
    {
      id: "database",
      name: "Database",
      ok: databaseOk,
      detail: databaseOk ? "PostgreSQL is reachable." : "PostgreSQL cannot be reached. Check DATABASE_URL in .env.local.",
    },
    {
      id: "worker",
      name: "Publisher",
      ok: workerRunning(heartbeat, now),
      detail: workerRunning(heartbeat, now)
        ? "Running: due Posts go out within a few seconds."
        : "Not running, so Posts are saved but nothing goes out. Start the service (npm run service:start) or npm run dev.",
    },
    {
      id: "ffmpeg",
      name: "FFmpeg",
      ok: ffmpeg !== null,
      detail: ffmpeg ?? "Not found on PATH. Install it (winget install Gyan.FFmpeg) and restart the app.",
    },
    {
      id: "chrome",
      name: "Google Chrome",
      ok: chromeInstalled(),
      optional: true,
      detail: chromeInstalled()
        ? "Installed. TikTok, Pinterest and X post through it, in windows of their own."
        : "Not found. TikTok, Pinterest and X need Google Chrome installed.",
    },
    {
      id: "meta",
      name: "Facebook Pages and Instagram",
      ok: metaMissing.length === 0,
      detail:
        metaMissing.length === 0
          ? "The Meta app is set up. Connect Pages and Instagram profiles on the Channels screen."
          : `Add ${metaMissing.join(" and ")} to .env.local (docs/setup.md, step 3), then restart the app.`,
    },
    {
      id: "threads",
      name: "Threads",
      ok: threadsMissing.length === 0,
      optional: true,
      detail:
        threadsMissing.length === 0
          ? "The Threads app is set up. Connect profiles on the Channels screen."
          : `Add ${threadsMissing.join(" and ")} to .env.local (docs/setup.md, step 3), then restart the app.`,
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      ok: linkedinMissing.length === 0,
      optional: true,
      detail:
        linkedinMissing.length === 0
          ? `The LinkedIn app is set up for ${process.env.LINKEDIN_PAGES === "1" ? "company Pages" : "your personal profile"}.`
          : `Add ${linkedinMissing.join(" and ")} to .env.local (docs/setup.md, LinkedIn), then restart the app.`,
    },
    {
      id: "google",
      name: "YouTube",
      ok: googleMissing.length === 0,
      optional: true,
      detail:
        googleMissing.length === 0
          ? "The Google app is set up. Connect YouTube channels on the Channels screen."
          : `Add ${googleMissing.join(" and ")} to .env.local (docs/setup.md, YouTube), then restart the app.`,
    },
    {
      id: "r2",
      name: "Cloudflare R2",
      ok: r2Missing.length === 0,
      detail:
        r2Missing.length === 0
          ? "Set up. Instagram and Threads fetch media from it. Use the test below to check it end to end."
          : `Needed for photos and videos on Instagram and Threads. Add ${r2Missing.join(", ")} to .env.local (docs/setup.md, step 4).`,
    },
    {
      id: "address",
      name: "App address",
      ok: true,
      detail: `${appUrl}. Network logins send you back here, so it must match the redirect URLs in the Meta, LinkedIn and Google apps.`,
    },
    {
      id: "startup",
      name: "Start at Windows login",
      ok: shortcut !== null && existsSync(shortcut),
      optional: true,
      detail:
        shortcut !== null && existsSync(shortcut)
          ? "On: the service starts hidden whenever you log in."
          : "Off: the service only runs when you start it.",
    },
  ];
}
