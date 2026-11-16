"use server";

import { execFile } from "node:child_process";
import path from "node:path";
import { runFormAction } from "@/app/form-action";
import { UserError } from "@/domain/errors";
import { testR2 } from "@/settings/r2-test";

function runScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(process.cwd(), "service", script)],
      { windowsHide: true, timeout: 30_000 },
      (error, _stdout, stderr) => (error ? reject(new UserError(stderr.trim() || error.message)) : resolve()),
    );
  });
}

export async function testR2Action() {
  await runFormAction("/settings", async () => {
    const problem = await testR2();
    if (problem) throw new UserError(`Cloudflare R2 test failed. ${problem}`);
    return "Cloudflare R2 works: a test file was uploaded, fetched from its public URL, and deleted.";
  });
}

export async function installStartupAction() {
  await runFormAction("/settings", async () => {
    await runScript("install-startup.ps1");
    return "The service will start at your next Windows login. Run npm run build first if you changed the code.";
  });
}

export async function uninstallStartupAction() {
  await runFormAction("/settings", async () => {
    await runScript("uninstall-startup.ps1");
    return "The service no longer starts at login.";
  });
}
