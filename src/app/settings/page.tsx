import { getDb } from "@/db/client";
import { setupStatus } from "@/settings/status";
import { browserSpacingMinutes } from "@/settings/values";
import { FlashMessages, Notice, PageHeader, Panel, PanelHeading, Pill, buttonClass, inputClass, labelClass } from "@/ui/primitives";
import { installStartupAction, setSpacingAction, testR2Action, uninstallStartupAction } from "./actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, items, spacing] = await Promise.all([searchParams, setupStatus(getDb()), browserSpacingMinutes(getDb())]);
  const required = items.filter((item) => !item.optional);
  const ready = required.every((item) => item.ok);
  const r2 = items.find((item) => item.id === "r2")!;
  const startup = items.find((item) => item.id === "startup")!;

  return (
    <>
      <PageHeader
        title="Settings"
        description="What the app needs to publish, and what is still missing. Keys and passwords live only in .env.local on this laptop."
      />
      <FlashMessages query={query} />
      {ready ? (
        <Notice tone="info">Everything needed to publish is in place.</Notice>
      ) : (
        <Notice tone="warning">
          {required.filter((item) => !item.ok).length} of {required.length} required items still need setting up. Each one
          says what to do; the full steps are in docs/setup.md.
        </Notice>
      )}

      <Panel>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-48 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-base font-medium">
                  {item.name}
                  {item.ok ? (
                    <Pill tone="ok">{item.id === "startup" ? "On" : "Ready"}</Pill>
                  ) : (
                    <Pill tone={item.optional ? "neutral" : "warn"}>
                      {item.id === "startup" ? "Off" : item.optional ? "Not set up" : "Needs setting up"}
                    </Pill>
                  )}
                </p>
                <p className="mt-1 text-sm leading-5 text-muted">{item.detail}</p>
              </div>
              {item.id === "r2" && r2.ok ? (
                <form action={testR2Action}>
                  <button type="submit" className={buttonClass.smallSecondary}>
                    Test R2
                  </button>
                </form>
              ) : null}
              {item.id === "startup" ? (
                <form action={startup.ok ? uninstallStartupAction : installStartupAction}>
                  <button type="submit" className={buttonClass.smallSecondary}>
                    {startup.ok ? "Turn off" : "Turn on"}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="mt-6 p-4">
        <PanelHeading>Pace of TikTok, Pinterest and X</PanelHeading>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">
          Deliveries to the same one of these networks go out one at a time, with at least this gap between them, so the
          accounts post at a human pace.
        </p>
        <form action={setSpacingAction} className="mt-3 flex flex-wrap items-end gap-2">
          <label className={labelClass}>
            Minutes between Deliveries
            <input type="number" name="minutes" min={1} max={120} defaultValue={spacing} className={`${inputClass} w-28`} />
          </label>
          <button type="submit" className={buttonClass.secondary}>
            Save
          </button>
        </form>
      </Panel>
    </>
  );
}
