// Development: `npm run dev` starts the web app and the background worker together.
// When APP_URL is an https address (needed for some network logins), Next.js serves HTTPS with a
// local certificate, which Windows asks to trust the first time.
import { spawn } from "node:child_process";
import path from "node:path";
import "@/env";
import { startWorker } from "../service/worker";

const https = (process.env.APP_URL ?? "").startsWith("https://");
const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const args = [next, "dev", "-H", "127.0.0.1", ...(https ? ["--experimental-https"] : [])];

const web = spawn(process.execPath, args, { stdio: "inherit" });

startWorker()
  .then((worker) => {
    const shutdown = async () => {
      await worker.stop().catch(() => {});
      web.kill();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error("[worker] Could not start:", error instanceof Error ? error.message : error);
    console.error("[worker] The web app still runs, but nothing will publish until this is fixed.");
  });

web.on("exit", (code) => process.exit(code ?? 0));
