import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { getDb } from "@/db/client";
import { handleLabel } from "@/domain/handle";
import { ConfirmButton } from "@/ui/confirm-button";
import { NetworkBadge } from "@/ui/network-badge";
import { FlashMessages, PageHeader, Panel, PanelHeading, buttonClass, inputClass, labelClass } from "@/ui/primitives";
import { createBrandAction, deleteBrandAction, renameBrandAction } from "./actions";

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, brands] = await Promise.all([searchParams, listBrandsWithChannels(getDb())]);

  return (
    <>
      <PageHeader
        title="Brands"
        description="A Brand is a company or product you promote. It groups the Channels that speak for it."
      />
      <FlashMessages query={query} />

      <Panel className="mb-6 p-4">
        <form action={createBrandAction} className="flex flex-wrap items-end gap-3">
          <label className={`${labelClass} min-w-64 flex-1`}>
            New Brand
            <input name="name" required maxLength={80} placeholder="Such as Acme" className={inputClass} />
          </label>
          <button type="submit" className={buttonClass.primary}>
            Create Brand
          </button>
        </form>
      </Panel>

      {brands.length === 0 ? (
        <p className="text-base text-muted">No Brands yet. Create your first one above.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {brands.map((brand) => (
            <li key={brand.id}>
              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <PanelHeading>{brand.name}</PanelHeading>
                    <p className="mt-0.5 text-sm text-muted">
                      {brand.channels.length === 0
                        ? "No Channels yet"
                        : `${brand.channels.length} ${brand.channels.length === 1 ? "Channel" : "Channels"}`}
                    </p>
                  </div>
                  <Link href="/channels" className={buttonClass.secondary}>
                    {brand.channels.length === 0 ? "Connect a Channel" : "Manage Channels"}
                  </Link>
                </div>

                {brand.channels.length > 0 ? (
                  <ul className="divide-y divide-border border-t border-border">
                    {brand.channels.map((channel) => (
                      <li key={channel.id} className="flex items-center gap-3 px-4 py-2.5">
                        <NetworkBadge network={channel.network} />
                        <span className="min-w-0 truncate text-base">{channel.displayName}</span>
                        {channel.handle ? (
                          <span className="text-sm text-muted">{handleLabel(channel.network, channel.handle)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <details className="border-t border-border px-4 py-3">
                  <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-muted hover:text-foreground">
                    Rename or delete
                  </summary>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                    <form action={renameBrandAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={brand.id} />
                      <label className={labelClass}>
                        Brand name
                        <input
                          name="name"
                          required
                          maxLength={80}
                          defaultValue={brand.name}
                          className={`${inputClass} w-64`}
                        />
                      </label>
                      <button type="submit" className={buttonClass.secondary}>
                        Rename
                      </button>
                    </form>
                    <form action={deleteBrandAction}>
                      <input type="hidden" name="id" value={brand.id} />
                      <ConfirmButton
                        message={`Delete the Brand "${brand.name}"? This cannot be undone.`}
                        className={buttonClass.danger}
                      >
                        Delete Brand
                      </ConfirmButton>
                    </form>
                  </div>
                </details>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
