import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { needsReconnect } from "@/channels/connect";
import { networkName } from "@/connectors/registry";
import { getDb } from "@/db/client";
import { dashboardData, unreadAlertCount } from "@/notify/queries";
import { calendarMonth, monthStart } from "@/posts/calendar";
import { setupStatus } from "@/settings/status";
import { Calendar } from "./calendar";
import { Notice, PageHeader, Panel, PanelHeading, buttonClass } from "@/ui/primitives";

const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function loadDashboard(month: string | undefined, now = new Date()) {
  const db = getDb();
  const start = monthStart(month, now);
  return Promise.all([
    listBrandsWithChannels(db),
    dashboardData(db, now),
    unreadAlertCount(db),
    setupStatus(db, now),
    calendarMonth(db, start),
    Promise.resolve({ start, now }),
  ]);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const [brands, { upcoming, failures }, unread, setup, days, { start, now }] = await loadDashboard(
    typeof query.month === "string" ? query.month : undefined,
  );
  const channels = brands.flatMap((brand) => brand.channels);
  const reconnectCount = channels.filter((channel) => needsReconnect(channel)).length;
  const workerDown = setup.find((item) => item.id === "worker")?.ok === false;
  const setupMissing = setup.filter((item) => !item.optional && !item.ok && item.id !== "worker").length;

  const metrics = [
    { label: "Coming up (7 days)", value: upcoming.length, href: "/posts" },
    { label: "Failed (7 days)", value: failures.length, href: "/posts" },
    { label: "Unread alerts", value: unread, href: "/alerts" },
    { label: "Channels", value: channels.length, href: "/channels" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Compose a Post once, publish it to every Channel.">
        <Link href="/compose" className={buttonClass.primary}>
          Compose
        </Link>
      </PageHeader>
      {workerDown ? (
        <Notice tone="error">
          The publisher is not running, so nothing goes out. Start it with npm run service:start (or npm run dev).{" "}
          <Link href="/settings" className="font-medium underline">
            Open Settings
          </Link>
        </Notice>
      ) : null}
      {setupMissing > 0 ? (
        <Notice tone="warning">
          Setup is not finished: {setupMissing} required {setupMissing === 1 ? "item needs" : "items need"} attention.{" "}
          <Link href="/settings" className="font-medium underline">
            Open Settings
          </Link>
        </Notice>
      ) : null}
      {reconnectCount > 0 ? (
        <Notice tone="warning">
          {reconnectCount === 1 ? "1 Channel needs" : `${reconnectCount} Channels need`} reconnecting.{" "}
          <Link href="/channels" className="font-medium underline">
            Open Channels
          </Link>
        </Notice>
      ) : null}

      <Panel className="mb-6 grid grid-cols-2 sm:grid-cols-4">
        {metrics.map((metric, index) => (
          <Link
            key={metric.label}
            href={metric.href}
            className={`block p-4 transition-colors hover:bg-hover ${index > 0 ? "border-l border-border" : ""} ${index >= 2 ? "max-sm:border-t" : ""} ${index === 2 ? "max-sm:border-l-0" : ""}`}
          >
            <p className="text-sm font-medium text-muted">{metric.label}</p>
            <p className="mt-2 text-[28px] leading-8 font-medium tabular-nums">{metric.value}</p>
          </Link>
        ))}
      </Panel>

      <Calendar start={start} days={days} today={now} />

      {brands.length === 0 ? (
        <p className="text-base text-muted">
          Start by{" "}
          <Link href="/brands" className="font-medium text-foreground underline">
            creating a Brand
          </Link>
          , then connect its Channels.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <div className="border-b border-border px-4 py-3">
              <PanelHeading>Coming up</PanelHeading>
            </div>
            {upcoming.length === 0 ? (
              <p className="px-4 py-3 text-base text-muted">Nothing scheduled for the next 7 days.</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map(({ delivery, channelName, network, caption }) => (
                  <li key={delivery.id}>
                    <Link href={`/posts/${delivery.postId}`} className="block px-4 py-2.5 transition-colors hover:bg-hover">
                      <span className="block text-xs text-muted tabular-nums">
                        {when.format(delivery.scheduledFor)} · {channelName} on {networkName(network)}
                      </span>
                      <span className="mt-0.5 block truncate text-base">{delivery.captionOverride ?? caption}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <div className="border-b border-border px-4 py-3">
              <PanelHeading>Recent failures</PanelHeading>
            </div>
            {failures.length === 0 ? (
              <p className="px-4 py-3 text-base text-muted">No Delivery failed in the last 7 days.</p>
            ) : (
              <ul className="divide-y divide-border">
                {failures.map(({ delivery, channelName, network }) => (
                  <li key={delivery.id}>
                    <Link href={`/posts/${delivery.postId}`} className="block px-4 py-2.5 transition-colors hover:bg-hover">
                      <span className="block text-sm font-medium">
                        {channelName} on {networkName(network)}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-danger">{delivery.lastError}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
