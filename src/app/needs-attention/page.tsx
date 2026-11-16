import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { networkName } from "@/connectors/registry";
import { getDb } from "@/db/client";
import { channels, deliveries, posts } from "@/db/schema";
import { FlashMessages, PageHeader, Panel, Pill, buttonClass } from "@/ui/primitives";
import { bringForwardAction } from "./actions";

async function load() {
  const db = getDb();
  const [paused, loggingIn] = await Promise.all([
    db
      .select({ delivery: deliveries, channel: channels, caption: posts.caption })
      .from(deliveries)
      .innerJoin(channels, eq(channels.id, deliveries.channelId))
      .innerJoin(posts, eq(posts.id, deliveries.postId))
      .where(eq(deliveries.status, "needs_attention")),
    db
      .select()
      .from(channels)
      .where(and(eq(channels.connectorKind, "browser"), sql`${channels.settings} ? 'loginStartedAt'`)),
  ]);
  return { paused, loggingIn };
}

export default async function NeedsAttentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, { paused, loggingIn }] = await Promise.all([searchParams, load()]);

  return (
    <>
      <PageHeader
        title="Needs attention"
        description="TikTok, Pinterest and X Deliveries that stopped at a login check, code or CAPTCHA. Clear it in the Channel's Chrome window and the Delivery carries on by itself."
      />
      <FlashMessages query={query} />

      {paused.length === 0 && loggingIn.length === 0 ? (
        <p className="text-base text-muted">Nothing is waiting for you.</p>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {paused.map(({ delivery, channel, caption }) => (
              <li key={delivery.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Pill tone="warn" live>
                  Waiting for you
                </Pill>
                <div className="min-w-48 flex-1">
                  <p className="text-base font-medium">
                    {channel.displayName} on {networkName(channel.network)}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{delivery.lastError ?? "Clear the check in the browser window."}</p>
                  <Link href={`/posts/${delivery.postId}`} className="mt-0.5 block truncate text-xs text-muted underline">
                    {caption || "Post"}
                  </Link>
                </div>
                <form action={bringForwardAction}>
                  <input type="hidden" name="channelId" value={channel.id} />
                  <button type="submit" className={buttonClass.primary}>
                    Bring window forward
                  </button>
                </form>
              </li>
            ))}
            {loggingIn.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Pill tone="warn" live>
                  Logging in
                </Pill>
                <div className="min-w-48 flex-1">
                  <p className="text-base font-medium">
                    {channel.displayName} on {networkName(channel.network)}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">Its Chrome window is open at the login page. Log in there.</p>
                </div>
                <form action={bringForwardAction}>
                  <input type="hidden" name="channelId" value={channel.id} />
                  <button type="submit" className={buttonClass.primary}>
                    Bring window forward
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
