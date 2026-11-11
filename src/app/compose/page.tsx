import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { needsReconnect } from "@/channels/connect";
import { getConnector, networkName } from "@/connectors/registry";
import { getDb } from "@/db/client";
import { listAssets } from "@/media/library";
import { toClientAsset } from "@/media/client-asset";
import { PageHeader, Panel, buttonClass } from "@/ui/primitives";
import { Composer, type ComposerBrand } from "./composer";

export default async function ComposePage() {
  const db = getDb();
  const [brands, assets] = await Promise.all([listBrandsWithChannels(db), listAssets(db)]);

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

  return (
    <>
      <PageHeader title="Compose" description="Write the Post once, pick the Channels, and publish now or schedule it." />
      {hasChannels ? (
        <Composer brands={composerBrands} library={assets.map(toClientAsset)} />
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
