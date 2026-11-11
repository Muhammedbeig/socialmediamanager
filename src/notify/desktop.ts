import { spawn } from "node:child_process";
import type { Alert, DesktopNotifier } from "./index";

// Windows desktop notifications through the built-in toast API, via PowerShell. No extra install.
// Clicking a notification opens the related screen in the default browser.

// Windows only shows toasts from a registered app; PowerShell's own ID is always present.
const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function toastXml(alert: Alert, appUrl: string): string {
  const launch = `${appUrl.replace(/\/$/, "")}${alert.link}`;
  return [
    `<toast activationType="protocol" launch="${xml(launch)}">`,
    "<visual><binding template=\"ToastGeneric\">",
    `<text>${xml(alert.title)}</text>`,
    `<text>${xml(alert.body.slice(0, 300))}</text>`,
    "</binding></visual>",
    "</toast>",
  ].join("");
}

/** Null when desktop notifications are off (tests, or DESKTOP_NOTIFICATIONS=0). */
export function desktopNotifier(): DesktopNotifier | undefined {
  if (process.platform !== "win32" || process.env.DESKTOP_NOTIFICATIONS === "0" || process.env.VITEST) return undefined;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return (alert) => {
    // The XML travels as base64, so nothing in it can break out of the PowerShell command.
    const payload = Buffer.from(toastXml(alert, appUrl), "utf8").toString("base64");
    const script = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null",
      `$xml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
      "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
      "$doc.LoadXml($xml)",
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($doc))`,
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
      windowsHide: true,
      stdio: "ignore",
      detached: false,
    });
    child.on("error", (error) => console.error("Desktop notification failed", error));
  };
}
