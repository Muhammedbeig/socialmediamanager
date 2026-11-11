import Link from "next/link";
import { getDb } from "@/db/client";
import { listAlerts } from "@/notify/queries";
import { FlashMessages, PageHeader, Panel, buttonClass } from "@/ui/primitives";
import { markAllReadAction } from "./actions";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, alerts] = await Promise.all([searchParams, listAlerts(getDb())]);
  const unread = alerts.filter((alert) => !alert.readAt).length;

  return (
    <>
      <PageHeader title="Alerts" description="Failed Deliveries, failed Removals and Channels that need reconnecting. Each one also showed as a desktop notification.">
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <button type="submit" className={buttonClass.secondary}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </PageHeader>
      <FlashMessages query={query} />

      {alerts.length === 0 ? (
        <p className="text-base text-muted">Nothing needs your attention.</p>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {alerts.map((alert) => (
              <li key={alert.id} className={`flex items-start gap-3 px-4 py-3 ${alert.readAt ? "" : "bg-selected-soft"}`}>
                <span
                  aria-hidden
                  className={`mt-[7px] size-1.5 shrink-0 rounded-full ${alert.readAt ? "bg-muted" : "bg-danger"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium">
                    {alert.title}
                    {alert.readAt ? null : <span className="sr-only"> (unread)</span>}
                  </p>
                  <p className="mt-0.5 text-sm leading-5 text-muted">{alert.body}</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">{when.format(alert.createdAt)}</p>
                </div>
                {alert.link ? (
                  <Link href={alert.link} className={buttonClass.smallSecondary}>
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
