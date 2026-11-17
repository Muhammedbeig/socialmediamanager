import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { loadPostDetail } from "@/deliveries/manage";
import { DELIVERY_STATUS_LABEL, POST_STATUS_LABEL } from "@/domain/post-status";
import { thumbUrl, toClientAsset } from "@/media/client-asset";
import { FlashMessages, PageHeader, Panel, Pill, buttonClass } from "@/ui/primitives";
import { AutoRefresh } from "./auto-refresh";
import { DeliveryActions, RemoveDialogButton } from "./delivery-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/** "Scheduled 11 Nov, 09:00 · posted 11:32", as the PRD asks. */
function timeline(scheduledFor: Date, publishedAt: Date | null): string {
  const scheduled = `Scheduled ${dayTime.format(scheduledFor)}`;
  if (!publishedAt) return scheduled;
  const posted = sameDay(scheduledFor, publishedAt) ? time.format(publishedAt) : dayTime.format(publishedAt);
  return `${scheduled} · posted ${posted}`;
}

/** True while a Delivery is being published or due within the next minute: the screen keeps itself fresh. */
function onItsWay(deliveries: { status: string; scheduledFor: Date }[], now = new Date()): boolean {
  return deliveries.some(
    (delivery) =>
      delivery.status === "publishing" ||
      (delivery.status === "scheduled" && delivery.scheduledFor.getTime() - now.getTime() < 60_000),
  );
}

const TONE = {
  scheduled: "neutral",
  publishing: "ok",
  published: "ok",
  failed: "danger",
  needs_attention: "warn",
  removed: "neutral",
} as const;

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const detail = await loadPostDetail(getDb(), id);
  if (!detail) notFound();

  const busy = onItsWay(detail.deliveries);
  const removable = detail.deliveries.filter((delivery) => delivery.status !== "removed");

  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader title="Post" description={`${detail.brandName} · created ${dayTime.format(detail.post.createdAt)}`}>
        <div className="flex flex-wrap gap-2">
          <Link href={`/compose?duplicate=${detail.post.id}`} className={buttonClass.secondary}>
            Duplicate to a Brand
          </Link>
          <RemoveDialogButton
            postId={detail.post.id}
            label="Remove…"
            hidden={removable.length === 0}
            deliveries={removable.map((delivery) => ({
              id: delivery.id,
              channel: `${delivery.channelName} on ${delivery.networkName}`,
              live: delivery.status === "published",
              note: delivery.status === "published" ? delivery.removalNote : "Not live yet: it will be cancelled.",
            }))}
          />
        </div>
      </PageHeader>
      <FlashMessages query={query} />

      <Panel className="mb-6 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Pill tone={detail.status === "failed" ? "danger" : detail.status === "partly_published" ? "warn" : detail.status === "scheduled" || detail.status === "removed" ? "neutral" : "ok"} live={detail.status === "publishing"}>
            {POST_STATUS_LABEL[detail.status]}
          </Pill>
        </div>
        {detail.media.length > 0 ? (
          <ul className="mb-3 flex flex-wrap gap-2">
            {detail.media.map((asset) => (
              <li key={asset.id} className="size-20 overflow-hidden rounded-md border border-border bg-hover">
                <img src={thumbUrl(asset.id)} alt={asset.originalName} className="size-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-base whitespace-pre-wrap">{detail.post.caption || <span className="text-muted">No caption</span>}</p>
      </Panel>

      <Panel>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-medium">Deliveries</h2>
          <p className="mt-0.5 text-sm text-muted">One per Channel. Each one succeeds, fails and is retried on its own.</p>
        </div>
        <ul className="divide-y divide-border">
          {detail.deliveries.map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3">
              <span
                aria-hidden
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  delivery.status === "published"
                    ? "bg-parrot text-parrot-ink"
                    : delivery.status === "failed"
                      ? "bg-danger text-danger-foreground"
                      : "bg-hover text-muted"
                }`}
              >
                {delivery.status === "published" ? "✓" : delivery.status === "failed" ? "✕" : "·"}
              </span>
              <div className="min-w-48 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{delivery.channelName}</span>
                  <span className="text-xs text-muted">{delivery.networkName}</span>
                  <Pill tone={TONE[delivery.status]} live={delivery.status === "publishing"}>
                    {DELIVERY_STATUS_LABEL[delivery.status]}
                  </Pill>
                  {delivery.replaced ? <span className="text-xs text-muted">Replacement</span> : null}
                </div>
                <p className="mt-1 text-xs text-muted tabular-nums">
                  {timeline(delivery.scheduledFor, delivery.publishedAt)}
                  {delivery.status === "publishing" && delivery.nextAttemptAt
                    ? ` · next try ${time.format(delivery.nextAttemptAt)} (attempt ${delivery.attempts + 1} of 4)`
                    : ""}
                </p>
                {delivery.liveUrl && delivery.status === "published" ? (
                  <a href={delivery.liveUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-medium underline">
                    View live post
                  </a>
                ) : null}
                {delivery.lastError && delivery.status !== "published" ? (
                  <p className="mt-1 text-xs text-danger">{delivery.lastError}</p>
                ) : null}
                {delivery.status === "removed" && delivery.removalResult?.note ? (
                  <p className="mt-1 text-xs text-muted">{delivery.removalResult.note}</p>
                ) : null}
                {delivery.status === "published" && delivery.removalResult && !delivery.removalResult.ok ? (
                  <p className="mt-1 text-xs text-danger">Removal failed: {delivery.removalResult.error}</p>
                ) : null}
                {delivery.captionOverride !== null ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">Own text: {delivery.captionOverride}</p>
                ) : null}
                {delivery.ownMedia ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">Own media:</span>
                    {delivery.ownMedia.length === 0 ? <span className="text-xs text-muted">none</span> : null}
                    {delivery.ownMedia.map((asset) => (
                      <img
                        key={asset.id}
                        src={thumbUrl(asset.id)}
                        alt={asset.originalName}
                        className="size-8 rounded-sm border border-border object-cover"
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <DeliveryActions
                postId={detail.post.id}
                delivery={{
                  id: delivery.id,
                  status: delivery.status,
                  channel: `${delivery.channelName} on ${delivery.networkName}`,
                  text: delivery.text,
                  media: (delivery.ownMedia ?? detail.media).map(toClientAsset),
                  canEdit: delivery.canEdit,
                  editNote: delivery.editNote,
                  removalNote: delivery.removalNote,
                  captionRules: delivery.captionRules,
                }}
              />
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
