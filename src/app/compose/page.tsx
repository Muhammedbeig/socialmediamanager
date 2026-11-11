import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { needsReconnect } from "@/channels/connect";
import { getConnector, networkName } from "@/connectors/registry";
import { getDb } from "@/db/client";
import { loadPostDetail } from "@/deliveries/manage";
import { listAssets } from "@/media/library";
import { toClientAsset } from "@/media/client-asset";
import { PageHeader, Panel, buttonClass } from "@/ui/primitives";
import { Composer, type ComposerBrand } from "./composer";

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = getDb();
  const query = await searchParams;
  const duplicateId = typeof query.duplicate === "string" ? query.duplicate : null;
  const [brands, assets, source] = await Promise.all([
    listBrandsWithChannels(db),
    listAssets(db),
    duplicateId ? loadPostDetail(db, duplicateId).catch(() => null) : null,
  ]);

  const composerBrands: ComposerBrand[] = brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    channels: brand.channels.map((channel) => {
      const connector = getConnector(channel.network);
      return {
        id: channel.id,
        name: channel.displayName,
        handle: channel.handle,
        network: channel.network,
        networkName: networkName(channel.network),
        capabilities: connector?.baseCapabilities ?? null,
        reconnect: needsReconnect(channel),
      };
    }),
  }));

  const hasChannels = composerBrands.some((brand) => brand.channels.length > 0);
  // Duplicate: start from another Post's caption and media, on a different Brand where there is one.
  const initial = source
    ? {
        caption: source.post.caption,
        media: source.media.map(toClientAsset),
        brandId:
          composerBrands.find((brand) => brand.id !== source.post.brandId && brand.channels.length > 0)?.id ??
          source.post.brandId,
      }
    : undefined;

  return (
    <>
      <PageHeader
        title={source ? "Duplicate Post" : "Compose"}
        description={
          source
            ? `A copy of a ${source.brandName} Post. Pick the Brand and Channels it should go to.`
            : "Write the Post once, pick the Channels, and publish now or schedule it."
        }
      />
      {hasChannels ? (
        <Composer brands={composerBrands} library={assets.map(toClientAsset)} initial={initial} />
      ) : (
        <Panel className="p-4">
          <p className="text-base">There are no Channels to publish to yet.</p>
          <Link href="/channels" className={`${buttonClass.primary} mt-3`}>
            Connect a Channel
          </Link>
        </Panel>
      )}
    </>
  );
}
