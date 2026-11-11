import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { needsReconnect } from "@/channels/connect";
import { listNetworks, missingEnv } from "@/connectors/registry";
import { getDb } from "@/db/client";
import { ConfirmButton } from "@/ui/confirm-button";
import { NetworkBadge } from "@/ui/network-badge";
import {
  FlashMessages,
  Notice,
  PageHeader,
  Panel,
  PanelHeading,
  Pill,
  buttonClass,
  inputClass,
  labelClass,
} from "@/ui/primitives";
import { disconnectChannelAction, moveChannelAction } from "./actions";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, brands] = await Promise.all([searchParams, listBrandsWithChannels(getDb())]);
  const networks = listNetworks();
  const notSetUp = networks.filter((entry) => missingEnv(entry).length > 0);
  const now = new Date();
  const reconnectCount = brands
    .flatMap((brand) => brand.channels)
    .filter((channel) => needsReconnect(channel, now)).length;

  return (
    <>
      <PageHeader
        title="Channels"
        description="A Channel is one connected profile or Page on one network. A Brand can have several on the same network."
      />
      <FlashMessages query={query} />
      {reconnectCount > 0 ? (
        <Notice tone="warning">
          {reconnectCount === 1 ? "1 Channel needs" : `${reconnectCount} Channels need`} reconnecting. Posts
          cannot go out to a Channel until you reconnect it.
        </Notice>
      ) : null}

      {brands.length === 0 ? (
        <Panel className="p-4">
          <p className="text-base">Channels belong to a Brand, so create a Brand first.</p>
          <Link href="/brands" className={`${buttonClass.primary} mt-3`}>
            Create a Brand
          </Link>
        </Panel>
      ) : (
        <>
          <Panel className="mb-8 p-4">
            <PanelHeading>Connect a Channel</PanelHeading>
            <p className="mt-1 text-base text-muted">
              Choose the Brand, then the network. You log in on the network&apos;s own page and come back here.
            </p>
            <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
              <label className={`${labelClass} mr-1`}>
                Brand
                <select name="brandId" className={`${inputClass} min-w-48`}>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
              {networks.map((entry) => (
                <button
                  key={entry.network}
                  type="submit"
                  formAction={`/api/channels/connect/${entry.network}`}
                  disabled={missingEnv(entry).length > 0}
                  className={buttonClass.secondary}
                >
                  Connect {entry.name}
                </button>
              ))}
            </form>
            {notSetUp.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1 text-sm leading-5 text-muted">
                {notSetUp.map((entry) => (
                  <li key={entry.network}>
                    {entry.name} is not set up yet: add{" "}
                    <code className="font-mono text-xs text-foreground">{missingEnv(entry).join(", ")}</code> to
                    .env.local (steps in docs/setup.md), then restart the app.
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <div className="flex flex-col gap-6">
            {brands.map((brand) => (
              <section key={brand.id} aria-labelledby={`brand-${brand.id}`}>
                <h2 id={`brand-${brand.id}`} className="mb-2 text-sm font-medium text-muted">
                  {brand.name}
                </h2>
                {brand.channels.length === 0 ? (
                  <p className="text-base text-muted">No Channels yet.</p>
                ) : (
                  <Panel>
                    <ul className="divide-y divide-border">
                      {brand.channels.map((channel) => {
                        const reconnect = needsReconnect(channel, now);
                        return (
                          <li key={channel.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
                            <NetworkBadge network={channel.network} />
                            <div className="min-w-40 flex-1">
                              <p className="truncate text-base font-medium">{channel.displayName}</p>
                              <p className="mt-0.5 text-xs text-muted">
                                {channel.handle ? `@${channel.handle} · ` : ""}
                                {channel.tokenExpiresAt
                                  ? `Login lasts until ${dateFormat.format(channel.tokenExpiresAt)}`
                                  : "Login does not expire"}
                              </p>
                            </div>
                            {reconnect ? <Pill tone="warn">Reconnect needed</Pill> : <Pill tone="ok">Connected</Pill>}

                            <div className="flex flex-wrap items-center gap-2">
                              {reconnect ? (
                                <form method="get" action={`/api/channels/connect/${channel.network}`}>
                                  <input type="hidden" name="brandId" value={brand.id} />
                                  <button type="submit" className={buttonClass.primary}>
                                    Reconnect
                                  </button>
                                </form>
                              ) : null}
                              {brands.length > 1 ? (
                                <form action={moveChannelAction} className="flex items-center gap-2">
                                  <input type="hidden" name="channelId" value={channel.id} />
                                  <select
                                    name="brandId"
                                    defaultValue={brand.id}
                                    aria-label={`Brand for ${channel.displayName}`}
                                    className={inputClass}
                                  >
                                    {brands.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button type="submit" className={buttonClass.secondary}>
                                    Move
                                  </button>
                                </form>
                              ) : null}
                              <form action={disconnectChannelAction}>
                                <input type="hidden" name="channelId" value={channel.id} />
                                <ConfirmButton
                                  message={`Disconnect ${channel.displayName}? The app forgets this Channel. Nothing changes on the network.`}
                                  className={buttonClass.danger}
                                >
                                  Disconnect
                                </ConfirmButton>
                              </form>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </Panel>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
