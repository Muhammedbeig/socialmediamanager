import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeNetwork } from "@/connectors/fake";
import type { Db } from "@/db/client";
import { runDelivery } from "@/jobs/run-delivery";
import { type Alert, raiseAlert } from "@/notify";
import { desktopNotifier, toastXml } from "@/notify/desktop";
import { listAlerts, markAlertsRead, unreadAlertCount } from "@/notify/queries";
import { openTestDb, resetTestDb } from "../helpers/db";
import { deliveryTo, fakeChannel } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const handle = await openTestDb();
  db = handle.db;
  close = () => handle.pool.end();
});
afterAll(() => close?.());
beforeEach(async () => {
  await resetTestDb(db);
  fakeNetwork.reset();
});

describe("alerts", () => {
  it("shows a failed Delivery on the badge and on the desktop, linked to its Post", async () => {
    const setup = await fakeChannel(db);
    const { post, delivery } = await deliveryTo(db, setup, { scheduledFor: new Date("2026-11-11T09:00:00Z") });
    fakeNetwork.failNext("publish", "rejected", "Banned word");
    const shown: Alert[] = [];

    await runDelivery(db, delivery.id, {
      now: () => new Date("2026-11-11T09:00:00Z"),
      mediaHost: null,
      desktop: (alert) => shown.push(alert),
    });

    expect(await unreadAlertCount(db)).toBe(1);
    expect(shown).toEqual([expect.objectContaining({ title: "Not published to Fake fake-1 on Fake network", link: `/posts/${post.id}` })]);
    const [listed] = await listAlerts(db);
    expect(listed.link).toBe(`/posts/${post.id}`);

    await markAlertsRead(db);
    expect(await unreadAlertCount(db)).toBe(0);
  });

  it("still records the alert when the desktop notification cannot be shown", async () => {
    await raiseAlert(
      db,
      { kind: "channel_reconnect", title: "Reconnect", body: "", link: "/channels" },
      () => {
        throw new Error("No notification service");
      },
    );
    expect(await unreadAlertCount(db)).toBe(1);
  });
});

describe("desktop notifications", () => {
  it("open the related screen when clicked, with the text escaped", () => {
    const xml = toastXml(
      { kind: "delivery_failed", title: "Not published to <Acme & Co>", body: 'He said "no"', link: "/posts/123" },
      "http://localhost:3000",
    );
    expect(xml).toContain('activationType="protocol" launch="http://localhost:3000/posts/123"');
    expect(xml).toContain("Not published to &lt;Acme &amp; Co&gt;");
    expect(xml).toContain("He said &quot;no&quot;");
  });

  it("are switched off in tests", () => {
    expect(desktopNotifier()).toBeUndefined();
  });
});
