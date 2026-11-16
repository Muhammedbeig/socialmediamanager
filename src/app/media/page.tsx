import Link from "next/link";
import { getDb } from "@/db/client";
import { listAssets } from "@/media/library";
import { formatBytes, formatDuration, thumbUrl } from "@/media/client-asset";
import { ConfirmButton } from "@/ui/confirm-button";
import { FlashMessages, PageHeader, buttonClass } from "@/ui/primitives";
import { deleteAssetAction } from "./actions";
import { LibraryUpload } from "./library-upload";

const STEP = 120;

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const shown = Math.min(5000, Math.max(STEP, Number(typeof query.show === "string" ? query.show : STEP) || STEP));
  // One extra row tells whether there are more to show.
  const rows = await listAssets(getDb(), shown + 1);
  const assets = rows.slice(0, shown);
  const hasMore = rows.length > shown;

  return (
    <>
      <PageHeader title="Media library" description="Photos and videos you upload here can be used in any Post." />
      <FlashMessages query={query} />
      <div className="mb-6">
        <LibraryUpload />
      </div>

      {assets.length === 0 ? (
        <p className="text-base text-muted">No files yet. Drop some above, or add them while composing a Post.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {assets.map((asset) => (
              <li key={asset.id} className="flex flex-col border border-border bg-page">
                <div className="relative aspect-square bg-hover">
                  <img src={thumbUrl(asset.id)} alt={asset.originalName} className="size-full object-cover" />
                  {asset.kind === "video" && asset.durationMs ? (
                    <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/70 px-1 text-xs text-white tabular-nums">
                      {formatDuration(asset.durationMs)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-start gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={asset.originalName}>
                      {asset.originalName}
                    </p>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ""}
                      {formatBytes(asset.sizeBytes)}
                    </p>
                  </div>
                  <form action={deleteAssetAction}>
                    <input type="hidden" name="id" value={asset.id} />
                    <ConfirmButton
                      message={`Delete "${asset.originalName}" from the library?`}
                      className={buttonClass.smallDanger}
                    >
                      Delete
                    </ConfirmButton>
                  </form>
                </div>
              </li>
            ))}
        </ul>
      )}
      {hasMore ? (
        <div className="mt-4 flex justify-center">
          <Link href={`/media?show=${shown + STEP}`} className={buttonClass.secondary} scroll={false}>
            Show more
          </Link>
        </div>
      ) : null}
    </>
  );
}
