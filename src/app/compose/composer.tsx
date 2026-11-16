"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { Capabilities, FieldSpec } from "@/connectors/types";
import type { CropRect, Network, TrimRange } from "@/db/schema";
import { type DraftMedia, type Issue, canPublish, captionLength, checkPost, countChars } from "@/domain/checks";
import { type ClientAsset, formatBytes, formatDuration, thumbUrl } from "@/media/client-asset";
import { MediaDropzone } from "@/ui/media-dropzone";
import { Notice, Panel, PanelHeading, buttonClass, inputClass, labelClass, textareaClass } from "@/ui/primitives";
import { createPostAction } from "./actions";
import { CropDialog } from "./crop-dialog";
import { TrimDialog } from "./trim-dialog";

export type ComposerChannel = {
  id: string;
  name: string;
  handle: string | null;
  network: Network;
  networkName: string;
  /** Null while the network's Connector is not built yet. */
  capabilities: Capabilities | null;
  reconnect: boolean;
};

export type ComposerBrand = { id: string; name: string; channels: ComposerChannel[] };

type CropTarget = { channelId: string; asset: ClientAsset; network: string; minAspect: number; maxAspect: number };
type TrimTarget = { channelId: string; asset: ClientAsset; network: string; minSeconds: number; maxSeconds: number };

/** A datetime-local value in the laptop's time zone, one hour from now, to the minute. */
function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDraftMedia(asset: ClientAsset): DraftMedia {
  return {
    assetId: asset.id,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  };
}

export function Composer({
  brands,
  library: initialLibrary,
  initial,
}: {
  brands: ComposerBrand[];
  library: ClientAsset[];
  /** Set when duplicating a Post. */
  initial?: { caption: string; media: ClientAsset[]; brandId: string };
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(
    initial?.brandId ?? brands.find((brand) => brand.channels.length > 0)?.id ?? brands[0].id,
  );
  const [library, setLibrary] = useState(initialLibrary);
  const [media, setMedia] = useState<ClientAsset[]>(initial?.media ?? []);
  const [showLibrary, setShowLibrary] = useState(false);
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [crops, setCrops] = useState<Record<string, Record<string, CropRect>>>({});
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [trims, setTrims] = useState<Record<string, Record<string, TrimRange>>>({});
  // Values for each Channel's extra network fields, such as a YouTube title.
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, string>>>({});
  const [trimTarget, setTrimTarget] = useState<TrimTarget | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduleValue, setScheduleValue] = useState(defaultScheduleValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // When the composer opened. The server checks against the real time again when saving.
  const [openedAt] = useState(() => Date.now());

  const brand = brands.find((b) => b.id === brandId)!;
  const draftMedia = useMemo(() => media.map(toDraftMedia), [media]);

  const checks = useMemo(() => {
    const result: Record<string, Issue[]> = {};
    for (const channel of brand.channels) {
      if (!channel.capabilities) continue;
      result[channel.id] = checkPost(
        {
          caption: overrides[channel.id] ?? caption,
          media: draftMedia,
          approvedCrops: crops[channel.id] ?? {},
          approvedTrims: trims[channel.id] ?? {},
          fields: fieldValues[channel.id] ?? {},
        },
        channel.capabilities,
        channel.networkName,
      );
    }
    return result;
  }, [brand, caption, overrides, draftMedia, crops, trims, fieldValues]);

  const pickedChannels = brand.channels.filter((channel) => picked.includes(channel.id));
  // The main counter follows the picked Channel (using the main caption) with the least room left.
  const tightest =
    pickedChannels
      .filter((channel) => channel.capabilities && overrides[channel.id] == null)
      .map((channel) => ({
        limit: channel.capabilities!.caption.maxChars,
        length: captionLength(caption, channel.capabilities!.caption),
      }))
      .sort((a, b) => a.limit - a.length - (b.limit - b.length))[0] ?? null;
  const scheduledDate = when === "later" ? new Date(scheduleValue) : null;
  const scheduleProblem =
    when === "later" && (!scheduleValue || Number.isNaN(scheduledDate!.getTime()))
      ? "Pick a date and time."
      : scheduledDate && scheduledDate.getTime() < openedAt
        ? "Pick a time in the future."
        : null;
  const ready =
    pickedChannels.length > 0 &&
    !scheduleProblem &&
    pickedChannels.every((channel) => canPublish(checks[channel.id] ?? []));

  function switchBrand(id: string) {
    setBrandId(id);
    setPicked([]);
    setOverrides({});
    setCrops({});
    setTrims({});
    setFieldValues({});
  }

  function addMedia(asset: ClientAsset) {
    setLibrary((current) => (current.some((a) => a.id === asset.id) ? current : [asset, ...current]));
    setMedia((current) => (current.some((a) => a.id === asset.id) || current.length >= 20 ? current : [...current, asset]));
  }

  function moveMedia(index: number, by: -1 | 1) {
    setMedia((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createPostAction({
        brandId,
        caption,
        assetIds: media.map((asset) => asset.id),
        deliveries: pickedChannels.map((channel) => ({
          channelId: channel.id,
          captionOverride: overrides[channel.id] ?? null,
          approvedCrops: crops[channel.id] ?? {},
          approvedTrims: trims[channel.id] ?? {},
          fields: fieldValues[channel.id] ?? {},
        })),
        scheduledFor: scheduledDate ? scheduledDate.toISOString() : null,
      });
      if (result.ok) {
        const notice = scheduledDate ? "Post scheduled." : "Publishing now.";
        router.push(`/posts/${result.postId}?notice=${encodeURIComponent(notice)}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {brands.length > 1 ? (
        <label className={`${labelClass} max-w-xs`}>
          Brand
          <select value={brandId} onChange={(event) => switchBrand(event.target.value)} className={inputClass}>
            {brands.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <PanelHeading>Media</PanelHeading>
          {library.length > 0 ? (
            <button
              type="button"
              className={buttonClass.smallSecondary}
              aria-expanded={showLibrary}
              onClick={() => setShowLibrary((open) => !open)}
            >
              {showLibrary ? "Hide library" : "Choose from library"}
            </button>
          ) : null}
        </div>

        {media.length > 0 ? (
          <ol className="mb-3 flex flex-wrap gap-3">
            {media.map((asset, index) => (
              <li key={asset.id} className="w-28">
                <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-hover">
                  <img src={thumbUrl(asset.id)} alt={asset.name} className="size-full object-cover" />
                  {asset.kind === "video" && asset.durationMs ? (
                    <span className="absolute right-1 bottom-1 rounded-sm bg-black/70 px-1 text-xs text-white tabular-nums">
                      {formatDuration(asset.durationMs)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    className={buttonClass.smallSecondary}
                    aria-label={`Move ${asset.name} earlier`}
                    disabled={index === 0}
                    onClick={() => moveMedia(index, -1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className={buttonClass.smallSecondary}
                    aria-label={`Move ${asset.name} later`}
                    disabled={index === media.length - 1}
                    onClick={() => moveMedia(index, 1)}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className={`${buttonClass.smallDanger} ml-auto`}
                    aria-label={`Remove ${asset.name} from the Post`}
                    onClick={() => setMedia((current) => current.filter((a) => a.id !== asset.id))}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        <MediaDropzone compact={media.length > 0} onUploaded={addMedia} />

        {showLibrary ? (
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2" aria-label="Media library">
            {library.map((asset) => {
              const chosen = media.some((a) => a.id === asset.id);
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    title={`${asset.name} · ${formatBytes(asset.sizeBytes)}`}
                    onClick={() =>
                      chosen ? setMedia((current) => current.filter((a) => a.id !== asset.id)) : addMedia(asset)
                    }
                    className={`block aspect-square w-full overflow-hidden rounded-md border-2 ${
                      chosen ? "border-parrot" : "border-transparent hover:border-input"
                    }`}
                  >
                    <img src={thumbUrl(asset.id)} alt={asset.name} className="size-full object-cover" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Panel>

      <Panel className="p-4">
        <label className={labelClass}>
          <span className="flex items-center justify-between">
            Caption
            <span
              className={`text-xs tabular-nums ${tightest && tightest.length > tightest.limit ? "text-danger" : "text-muted"}`}
            >
              {tightest
                ? `${tightest.length.toLocaleString("en")} / ${tightest.limit.toLocaleString("en")}`
                : countChars(caption).toLocaleString("en")}
            </span>
          </span>
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={6}
            placeholder="Write once. You can change it for single Channels below."
            className={`${textareaClass} font-normal`}
          />
        </label>
      </Panel>

      <Panel>
        <div className="border-b border-border p-4">
          <PanelHeading>Channels</PanelHeading>
          <p className="mt-0.5 text-sm text-muted">Each picked Channel gets its own Delivery.</p>
        </div>
        {brand.channels.length === 0 ? (
          <p className="p-4 text-base text-muted">{brand.name} has no Channels yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {brand.channels.map((channel) => {
              const isPicked = picked.includes(channel.id);
              const unavailable = channel.reconnect
                ? "Needs reconnecting"
                : !channel.capabilities
                  ? `Publishing to ${channel.networkName} is not available yet`
                  : null;
              const issues = checks[channel.id] ?? [];
              const override = overrides[channel.id];
              const limit = channel.capabilities?.caption.maxChars;
              const ownLength = channel.capabilities
                ? captionLength(override ?? caption, channel.capabilities.caption)
                : countChars(override ?? caption);
              return (
                <li key={channel.id} className={isPicked ? "bg-selected-soft" : undefined}>
                  <label
                    className={`flex items-center gap-3 px-4 py-3 ${unavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 rounded accent-[#b8ff2c]"
                      checked={isPicked}
                      disabled={Boolean(unavailable)}
                      onChange={(event) =>
                        setPicked((current) =>
                          event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">{channel.name}</span>
                      <span className="block text-xs text-muted">
                        {channel.networkName}
                        {channel.handle ? ` · @${channel.handle}` : ""}
                        {unavailable ? ` · ${unavailable}` : ""}
                      </span>
                    </span>
                    {isPicked && limit ? (
                      <span className={`text-xs tabular-nums ${ownLength > limit ? "text-danger" : "text-muted"}`}>
                        {ownLength.toLocaleString("en")} / {limit.toLocaleString("en")}
                      </span>
                    ) : null}
                  </label>

                  {isPicked ? (
                    <div className="flex flex-col gap-2 px-4 pb-3 pl-11">
                      {issues.map((issue, index) => (
                        <IssueRow
                          key={`${issue.kind}-${issue.assetId ?? ""}-${index}`}
                          issue={issue}
                          onPreview={() => {
                            const asset = media.find((a) => a.id === issue.assetId);
                            if (!asset) return;
                            if (issue.kind === "crop") {
                              setCropTarget({
                                channelId: channel.id,
                                asset,
                                network: channel.networkName,
                                minAspect: issue.minAspect,
                                maxAspect: issue.maxAspect,
                              });
                            } else if (issue.kind === "trim") {
                              setTrimTarget({
                                channelId: channel.id,
                                asset,
                                network: channel.networkName,
                                minSeconds: issue.minSeconds,
                                maxSeconds: issue.maxSeconds,
                              });
                            }
                          }}
                        />
                      ))}
                      {(channel.capabilities?.fields ?? []).map((spec) => (
                        <FieldInput
                          key={spec.key}
                          spec={spec}
                          value={fieldValues[channel.id]?.[spec.key] ?? spec.defaultValue ?? ""}
                          onChange={(value) =>
                            setFieldValues((current) => ({
                              ...current,
                              [channel.id]: { ...current[channel.id], [spec.key]: value },
                            }))
                          }
                        />
                      ))}
                      {override == null ? (
                        <button
                          type="button"
                          className={`${buttonClass.smallSecondary} w-fit`}
                          onClick={() => setOverrides((current) => ({ ...current, [channel.id]: caption }))}
                        >
                          Change caption for this Channel
                        </button>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <textarea
                            aria-label={`Caption for ${channel.name} on ${channel.networkName}`}
                            value={override}
                            rows={4}
                            onChange={(event) =>
                              setOverrides((current) => ({ ...current, [channel.id]: event.target.value }))
                            }
                            className={textareaClass}
                          />
                          <button
                            type="button"
                            className={`${buttonClass.smallSecondary} w-fit`}
                            onClick={() =>
                              setOverrides((current) => {
                                const next = { ...current };
                                delete next[channel.id];
                                return next;
                              })
                            }
                          >
                            Use the main caption
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="p-4">
        <fieldset>
          <legend className="text-base font-medium">When</legend>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-base">
              <input type="radio" name="when" className="size-4 accent-[#b8ff2c]" checked={when === "now"} onChange={() => setWhen("now")} />
              Publish now
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-base">
              <input type="radio" name="when" className="size-4 accent-[#b8ff2c]" checked={when === "later"} onChange={() => setWhen("later")} />
              Schedule
            </label>
            {when === "later" ? (
              <input
                type="datetime-local"
                aria-label="Publish at"
                value={scheduleValue}
                onChange={(event) => setScheduleValue(event.target.value)}
                className={inputClass}
              />
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted">
            Times use this laptop&apos;s time zone. A Post due while the laptop sleeps goes out when it wakes.
          </p>
          {scheduleProblem ? <p className="mt-1 text-xs text-danger">{scheduleProblem}</p> : null}
        </fieldset>
      </Panel>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass.primary} disabled={!ready || pending} onClick={submit}>
          {pending ? "Saving…" : when === "later" ? "Schedule Post" : "Publish now"}
        </button>
        {!ready && !pending ? (
          <p className="text-sm text-muted">
            {pickedChannels.length === 0
              ? "Pick at least one Channel."
              : scheduleProblem ?? "Fix the problems flagged under the Channels first."}
          </p>
        ) : null}
      </div>

      {cropTarget ? (
        <CropDialog
          key={`${cropTarget.channelId}-${cropTarget.asset.id}`}
          asset={cropTarget.asset}
          network={cropTarget.network}
          minAspect={cropTarget.minAspect}
          maxAspect={cropTarget.maxAspect}
          initial={crops[cropTarget.channelId]?.[cropTarget.asset.id]}
          onClose={() => setCropTarget(null)}
          onApprove={(crop) => {
            setCrops((current) => ({
              ...current,
              [cropTarget.channelId]: { ...current[cropTarget.channelId], [cropTarget.asset.id]: crop },
            }));
            setCropTarget(null);
          }}
        />
      ) : null}

      {trimTarget ? (
        <TrimDialog
          key={`${trimTarget.channelId}-${trimTarget.asset.id}`}
          asset={trimTarget.asset}
          network={trimTarget.network}
          minSeconds={trimTarget.minSeconds}
          maxSeconds={trimTarget.maxSeconds}
          initial={trims[trimTarget.channelId]?.[trimTarget.asset.id]}
          onClose={() => setTrimTarget(null)}
          onApprove={(trim) => {
            setTrims((current) => ({
              ...current,
              [trimTarget.channelId]: { ...current[trimTarget.channelId], [trimTarget.asset.id]: trim },
            }));
            setTrimTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** One extra network field, such as a YouTube title or a Pinterest board. */
function FieldInput({ spec, value, onChange }: { spec: FieldSpec; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex max-w-md flex-col gap-1 text-xs font-medium">
      <span>
        {spec.label}
        {spec.required ? <span className="text-muted"> (required)</span> : null}
      </span>
      {spec.kind === "select" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={spec.maxLength} className={inputClass} />
      )}
      {spec.help ? <span className="font-normal text-muted">{spec.help}</span> : null}
    </label>
  );
}

function IssueRow({ issue, onPreview }: { issue: Issue; onPreview: () => void }) {
  if (issue.kind === "crop" || issue.kind === "trim") {
    const noun = issue.kind === "crop" ? "crop" : "trim";
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span aria-hidden className={`size-1.5 rounded-full ${issue.approved ? "bg-parrot" : "bg-warning"}`} />
        <span>{issue.approved ? `${noun === "crop" ? "Crop" : "Trim"} approved.` : issue.message}</span>
        <button type="button" className={buttonClass.smallSecondary} onClick={onPreview}>
          {issue.approved ? `Change ${noun}` : `Preview ${noun}`}
        </button>
      </div>
    );
  }
  return (
    <p className="flex items-start gap-2 text-xs">
      <span
        aria-hidden
        className={`mt-[5px] size-1.5 shrink-0 rounded-full ${issue.kind === "block" ? "bg-danger" : "bg-muted"}`}
      />
      <span className={issue.kind === "block" ? "text-danger" : "text-muted"}>{issue.message}</span>
    </p>
  );
}
