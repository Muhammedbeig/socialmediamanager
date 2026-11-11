import Link from "next/link";
import { getDb } from "@/db/client";
import { DELIVERY_STATUS_LABEL, POST_STATUS_LABEL, type PostStatus } from "@/domain/post-status";
import { thumbUrl } from "@/media/client-asset";
import { listPosts } from "@/posts/service";
import { FlashMessages, PageHeader, Panel, Pill, buttonClass } from "@/ui/primitives";

const timeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

const STATUS_TONE: Record<PostStatus, "ok" | "warn" | "danger" | "neutral"> = {
  scheduled: "neutral",
  publishing: "ok",
  published: "ok",
  partly_published: "warn",
  failed: "danger",
  removed: "neutral",
};

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, posts] = await Promise.all([searchParams, listPosts(getDb())]);

  return (
    <>
      <PageHeader title="Posts" description="Every Post, with one Delivery per Channel.">
        <Link href="/compose" className={buttonClass.primary}>
          Compose
        </Link>
      </PageHeader>
      <FlashMessages query={query} />

      {posts.length === 0 ? (
        <p className="text-base text-muted">No Posts yet.</p>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {posts.map((post) => (
              <li key={post.id} className="flex gap-3 px-4 py-3">
                <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border bg-hover">
                  {post.firstAssetId ? (
                    <img src={thumbUrl(post.firstAssetId)} alt="" className="size-full object-cover" />
                  ) : (
                    <span aria-hidden className="flex size-full items-center justify-center text-xs text-muted">
                      Aa
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={STATUS_TONE[post.status]} live={post.status === "publishing"}>
                      {POST_STATUS_LABEL[post.status]}
                    </Pill>
                    <span className="text-xs text-muted">
                      {post.brandName} ·{" "}
                      {post.scheduledFor ? `Scheduled ${timeFormat.format(post.scheduledFor)}` : `Created ${timeFormat.format(post.createdAt)}`}
                      {post.mediaCount > 1 ? ` · ${post.mediaCount} files` : ""}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-base">{post.caption || <span className="text-muted">No caption</span>}</p>
                  <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {post.deliveries.map((delivery) => (
                      <li key={delivery.id}>
                        {delivery.channelName}: {DELIVERY_STATUS_LABEL[delivery.status]}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
