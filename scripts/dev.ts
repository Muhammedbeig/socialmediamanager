// Starts the web app for development: `npm run dev`.
// When APP_URL is an https address (needed for network logins), Next.js serves HTTPS with a
// local certificate, which Windows asks to trust the first time.
import { spawn } from "node:child_process";
import path from "node:path";
import "@/env";

const https = (process.env.APP_URL ?? "").startsWith("https://");
const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const args = [next, "dev", "-H", "127.0.0.1", ...(https ? ["--experimental-https"] : [])];

spawn(process.execPath, args, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
