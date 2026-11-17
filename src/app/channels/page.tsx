import Link from "next/link";
import { listBrandsWithChannels } from "@/brands/service";
import { needsReconnect } from "@/channels/connect";
import type { Network } from "@/db/schema";
import { connectLabel, connectOptionFor, entryKey, listNetworks, missingEnv } from "@/connectors/registry";
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
import {
  addBrowserChannelAction,
  bringForwardAction,
  disconnectChannelAction,
  loginAgainAction,
  moveChannelAction,
  setPremiumAction,
} from "./actions";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Reconnect the way the Channel connected first. */
function reconnectKey(channel: { network: Network; settings: Record<string, unknown> }): string {
  const option = connectOptionFor(channel);
  return option ? entryKey(option) : channel.network;
}

/** Where a browser Channel's login stands, from its settings. */
function browserLoginState(settings: Record<string, unknown>) {
  return {
    requested: typeof settings.loginRequestedAt === "string",
    inWindow: typeof settings.loginStartedAt === "string",
    error: typeof settings.loginError === "string" ? settings.loginError : null,
  };
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, brands] = await Promise.all([searchParams, listBrandsWithChannels(getDb())]);
  const networks = listNetworks();
  const apiNetworks = networks.filter((entry) => entry.kind === "api");
  const browserNetworks = networks.filter((entry) => entry.kind === "browser");
  const notSetUp = apiNetworks.filter((entry) => missingEnv(entry).length > 0);
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
              {apiNetworks.map((entry) => (
                <button
                  key={entryKey(entry)}
                  type="submit"
                  formAction={`/api/channels/connect/${entryKey(entry)}`}
                  disabled={missingEnv(entry).length > 0}
                  className={buttonClass.secondary}
                >
                  {connectLabel(entry)}
                </button>
              ))}
            </form>
            <p className="mt-3 max-w-3xl text-sm leading-5 text-muted">
              Instagram through Facebook needs the profile linked to one of your Facebook Pages, and can remove posts.
              Instagram directly needs no Page, but the app cannot remove its posts: you delete them in Instagram.
            </p>
            {notSetUp.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1 text-sm leading-5 text-muted">
                {notSetUp.map((entry) => (
                  <li key={entryKey(entry)}>
                    {connectLabel(entry)} is not set up yet: add{" "}
                    <code className="font-mono text-xs text-foreground">{missingEnv(entry).join(", ")}</code> to
                    .env.local (steps in docs/setup.md), then restart the app.
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel className="mb-8 p-4">
            <PanelHeading>Add a TikTok, Pinterest or X account</PanelHeading>
            <p className="mt-1 max-w-3xl text-base text-muted">
              These post through their websites in a Chrome window of their own, separate from your Chrome. After you add
              one, its window opens at the login page: log in there once. The publisher must be running.
            </p>
            <form action={addBrowserChannelAction} className="mt-4 flex flex-wrap items-end gap-2">
              <label className={labelClass}>
                Brand
                <select name="brandId" className={`${inputClass} min-w-40`}>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Network
                <select name="network" className={inputClass}>
                  {browserNetworks.map((entry) => (
                    <option key={entry.network} value={entry.network}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Name in this app
                <input name="displayName" required maxLength={80} placeholder="Such as Acme on TikTok" className={`${inputClass} w-56`} />
              </label>
              <label className={labelClass}>
                Handle
                <input name="handle" maxLength={100} placeholder="@acme" className={`${inputClass} w-40`} />
              </label>
              <button type="submit" className={buttonClass.primary}>
                Add account
              </button>
            </form>
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
                        const browser = channel.connectorKind === "browser";
                        const login = browserLoginState(channel.settings);
                        return (
                          <li key={channel.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
                            <NetworkBadge network={channel.network} />
                            <div className="min-w-40 flex-1">
                              <p className="truncate text-base font-medium">{channel.displayName}</p>
                              <p className="mt-0.5 text-xs text-muted">
                                {channel.handle ? `@${channel.handle} · ` : ""}
                                {browser
                                  ? "Posts through its own Chrome window"
                                  : channel.tokenExpiresAt
                                    ? `Login lasts until ${dateFormat.format(channel.tokenExpiresAt)}`
                                    : "Login does not expire"}
                                {channel.network === "instagram"
                                  ? channel.settings.login === "instagram"
                                    ? " · Connected directly: delete removed posts in Instagram yourself"
                                    : " · Connected through Facebook"
                                  : ""}
                              </p>
                              {browser && login.error ? <p className="mt-0.5 text-xs text-danger">Last login: {login.error}</p> : null}
                            </div>
                            {browser && login.inWindow ? (
                              <Pill tone="warn" live>
                                Log in in its Chrome window
                              </Pill>
                            ) : browser && login.requested ? (
                              <Pill tone="neutral" live>
                                Opening its window
                              </Pill>
                            ) : reconnect ? (
                              <Pill tone="warn">{browser ? "Log in needed" : "Reconnect needed"}</Pill>
                            ) : (
                              <Pill tone="ok">Connected</Pill>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              {browser && login.inWindow ? (
                                <form action={bringForwardAction}>
                                  <input type="hidden" name="channelId" value={channel.id} />
                                  <button type="submit" className={buttonClass.secondary}>
                                    Bring window forward
                                  </button>
                                </form>
                              ) : null}
                              {browser && !login.inWindow && !login.requested ? (
                                <form action={loginAgainAction}>
                                  <input type="hidden" name="channelId" value={channel.id} />
                                  <button type="submit" className={reconnect ? buttonClass.primary : buttonClass.secondary}>
                                    {reconnect ? "Log in" : "Log in again"}
                                  </button>
                                </form>
                              ) : null}
                              {channel.network === "x" ? (
                                <form action={setPremiumAction} className="flex items-center gap-2">
                                  <input type="hidden" name="channelId" value={channel.id} />
                                  <label className="flex items-center gap-1.5 text-sm">
                                    <input
                                      type="checkbox"
                                      name="premium"
                                      defaultChecked={channel.settings.premium === true}
                                      className="size-4 accent-[#b8ff2c]"
                                    />
                                    Premium
                                  </label>
                                  <button type="submit" className={buttonClass.smallSecondary}>
                                    Save
                                  </button>
                                </form>
                              ) : null}
                              {!browser && reconnect ? (
                                <form method="get" action={`/api/channels/connect/${reconnectKey(channel)}`}>
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
