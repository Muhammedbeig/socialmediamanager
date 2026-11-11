// The background service: the web app (production build) and the worker in one process.
// Started at Windows login by service/start.ps1 (see service/install-startup.ps1).
// Run by hand with `npm run service` after `npm run build`.
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import next from "next";
import "@/env";
import { startWorker } from "./worker";

const root = process.cwd();
const appUrl = new URL(process.env.APP_URL ?? "http://localhost:3000");
const port = Number(appUrl.port || (appUrl.protocol === "https:" ? 443 : 80));
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

async function main() {
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    throw new Error("There is no production build yet. Run `npm run build` first.");
  }

  const worker = await startWorker({ log: (message) => log(`[worker] ${message}`) });

  const app = next({ dev: false, dir: root, hostname: "127.0.0.1", port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const listener: http.RequestListener = (request, response) => {
    handle(request, response).catch((error: unknown) => {
      log(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
      response.statusCode = 500;
      response.end("Internal error");
    });
  };

  // HTTPS when APP_URL asks for it, with the local certificate `npm run dev` created (docs/setup.md, step 5).
  let server: http.Server;
  if (appUrl.protocol === "https:") {
    const key = path.join(root, "certificates", "localhost-key.pem");
    const cert = path.join(root, "certificates", "localhost.pem");
    if (!existsSync(key) || !existsSync(cert)) {
      throw new Error("APP_URL is https, but there is no local certificate. Run `npm run dev` once to create it.");
    }
    server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, listener);
  } else {
    server = http.createServer(listener);
  }

  // Only this laptop can reach the app (docs/adr/0002).
  server.listen(port, "127.0.0.1", () => log(`Social Publisher is running at ${appUrl.origin}`));

  const shutdown = async () => {
    log("Stopping.");
    server.close();
    await worker.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log(`Could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
