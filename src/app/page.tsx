import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { needsReconnect } from "@/channels/connect";
import { getDb } from "@/db/client";
import { Notice, PageHeader, Panel } from "@/ui/primitives";

export default async function DashboardPage() {
  const brands = await listBrandsWithChannels(getDb());
  const channels = brands.flatMap((brand) => brand.channels);
  const reconnectCount = channels.filter((channel) => needsReconnect(channel)).length;

  const metrics = [
    { label: "Brands", value: brands.length, href: "/brands" },
    { label: "Channels", value: channels.length, href: "/channels" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Compose a Post once, publish it to every Channel." />
      {reconnectCount > 0 ? (
        <Notice tone="warning">
          {reconnectCount === 1 ? "1 Channel needs" : `${reconnectCount} Channels need`} reconnecting.{" "}
          <Link href="/channels" className="font-medium underline">
            Open Channels
          </Link>
        </Notice>
      ) : null}
      <Panel className="grid divide-x divide-border sm:grid-cols-2">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="block p-4 transition-colors hover:bg-hover">
            <p className="text-sm font-medium text-muted">{metric.label}</p>
            <p className="mt-2 text-[28px] leading-8 font-medium tabular-nums">{metric.value}</p>
          </Link>
        ))}
      </Panel>
      {brands.length === 0 ? (
        <p className="mt-5 text-base text-muted">
          Start by{" "}
          <Link href="/brands" className="font-medium text-foreground underline">
            creating a Brand
          </Link>
          , then connect its Channels.
        </p>
      ) : null}
    </>
  );
}
