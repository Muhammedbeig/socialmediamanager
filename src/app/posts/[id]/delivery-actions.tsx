"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Capabilities } from "@/connectors/types";
import type { DeliveryStatus } from "@/db/schema";
import type { RemovalReport } from "@/deliveries/manage";
import { captionLength } from "@/domain/checks";
import { type ClientAsset, thumbUrl } from "@/media/client-asset";
import { Dialog } from "@/ui/dialog";
import { MediaDropzone } from "@/ui/media-dropzone";
import { Notice, buttonClass, textareaClass } from "@/ui/primitives";
import { type ActionResult, editAction, listLibraryAction, removeAction, replaceAction, retryAction } from "./actions";

type DeliveryView = {
  id: string;
  status: DeliveryStatus;
  channel: string;
  text: string;
  /** The media this Delivery sent. */
  media: ClientAsset[];
  canEdit: boolean;
  editNote: string;
  removalNote: string;
  captionRules: Capabilities["caption"] | null;
};

export function DeliveryActions({ postId, delivery }: { postId: string; delivery: DeliveryView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [textMode, setTextMode] = useState<"edit" | "replace" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  };

  const live = delivery.status === "published";
  const cancellable = delivery.status === "scheduled" || delivery.status === "failed";
  const removal = {
    id: delivery.id,
    channel: delivery.channel,
    live,
    note: live ? delivery.removalNote : "Not live yet: it will be cancelled.",
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {delivery.status === "failed" ? (
          <button type="button" className={buttonClass.smallPrimary} disabled={pending} onClick={() => run(() => retryAction(postId, delivery.id))}>
            Retry
          </button>
        ) : null}
        {live && delivery.canEdit ? (
          <button type="button" className={buttonClass.smallSecondary} disabled={pending} onClick={() => setTextMode("edit")}>
            Edit
          </button>
        ) : null}
        {live ? (
          // Replace is offered everywhere: it is how media changes, and the only change where Edit is not possible.
          <button type="button" className={buttonClass.smallSecondary} disabled={pending} onClick={() => setTextMode("replace")}>
            Replace…
          </button>
        ) : null}
        <RemoveDialogButton
          postId={postId}
          deliveries={[removal]}
          label={live ? "Remove…" : "Cancel…"}
          hidden={!live && !cancellable}
          small
        />
      </div>
      {error ? <p className="max-w-64 text-right text-xs text-danger">{error}</p> : null}

      {textMode ? (
        <TextDialog
          mode={textMode}
          delivery={delivery}
          onClose={() => setTextMode(null)}
          onSubmit={async (text, mediaIds) => {
            const result =
              textMode === "edit"
                ? await editAction(postId, delivery.id, text)
                : await replaceAction(postId, delivery.id, text, mediaIds);
            if (result.ok) {
              setTextMode(null);
              router.refresh();
            }
            return result;
          }}
        />
      ) : null}
    </div>
  );
}

function TextDialog({
  mode,
  delivery,
  onClose,
  onSubmit,
}: {
  mode: "edit" | "replace";
  delivery: DeliveryView;
  onClose: () => void;
  onSubmit: (text: string, mediaIds: string[] | null) => Promise<ActionResult>;
}) {
  const [text, setText] = useState(delivery.text);
  // Null keeps the media this Delivery already has.
  const [media, setMedia] = useState<ClientAsset[] | null>(null);
  const [library, setLibrary] = useState<ClientAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rules = delivery.captionRules;
  const length = rules ? captionLength(text, rules) : text.length;
  const tooLong = rules ? length > rules.maxChars : false;
  const shown = media ?? delivery.media;
  const empty = text.trim().length === 0 && shown.length === 0;

  const changeMedia = () => {
    setMedia(delivery.media);
    if (!library) void listLibraryAction().then(setLibrary);
  };
  const toggle = (asset: ClientAsset) =>
    setMedia((current) => {
      const list = current ?? [];
      return list.some((a) => a.id === asset.id) ? list.filter((a) => a.id !== asset.id) : [...list, asset];
    });

  return (
    <Dialog
      title={mode === "edit" ? `Edit text on ${delivery.channel}` : `Replace on ${delivery.channel}?`}
      description={
        mode === "edit"
          ? "The text changes in place on the network. To change the media, use Replace."
          : `${delivery.canEdit ? "" : `${delivery.editNote} `}Replace removes the live post and publishes a new one with this text and media.`
      }
      width={mode === "replace" ? 768 : 512}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {mode === "edit" ? "Cancel" : "Keep as is"}
          </button>
          <button
            type="button"
            className={mode === "edit" ? buttonClass.primary : buttonClass.dangerFill}
            disabled={pending || tooLong || empty || (mode === "edit" && text === delivery.text)}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await onSubmit(text, media ? media.map((a) => a.id) : null);
                if (!result.ok) setError(result.error);
              })
            }
          >
            {pending ? "Working…" : mode === "edit" ? "Save edit" : "Replace post"}
          </button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="flex justify-between">
          Text
          {rules ? (
            <span className={`text-xs tabular-nums ${tooLong ? "text-danger" : "text-muted"}`}>
              {length.toLocaleString("en")} / {rules.maxChars.toLocaleString("en")}
            </span>
          ) : null}
        </span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} className={textareaClass} />
      </label>

      {mode === "replace" ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Media{media ? " (new)" : ""}</p>
            {media ? (
              <button type="button" className={buttonClass.smallSecondary} onClick={() => setMedia(null)}>
                Keep current media
              </button>
            ) : (
              <button type="button" className={buttonClass.smallSecondary} onClick={changeMedia}>
                Change media
              </button>
            )}
          </div>
          {shown.length > 0 ? (
            <ol className="mt-2 flex flex-wrap gap-2" aria-label="Media in order">
              {shown.map((asset, index) => (
                <li key={asset.id} className="relative size-16 overflow-hidden rounded-md border border-border bg-hover">
                  <img src={thumbUrl(asset.id)} alt={asset.name} className="size-full object-cover" />
                  <span className="absolute top-0.5 left-0.5 rounded-sm bg-black/70 px-1 text-xs text-white">{index + 1}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-muted">No media: a text-only post.</p>
          )}

          {media ? (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-muted">Click files to add or take them out; they go in the order you click.</p>
              <MediaDropzone
                compact
                onUploaded={(asset) => {
                  setLibrary((current) => [asset, ...(current ?? []).filter((a) => a.id !== asset.id)]);
                  setMedia((current) => [...(current ?? []).filter((a) => a.id !== asset.id), asset]);
                }}
              />
              {library === null ? (
                <p className="text-xs text-muted">Loading the media library…</p>
              ) : (
                <ul className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 overflow-y-auto" aria-label="Media library">
                  {library.map((asset) => {
                    const chosen = media.some((a) => a.id === asset.id);
                    return (
                      <li key={asset.id}>
                        <button
                          type="button"
                          aria-pressed={chosen}
                          title={asset.name}
                          onClick={() => toggle(asset)}
                          className={`block aspect-square w-full overflow-hidden rounded-md border-2 ${chosen ? "border-parrot" : "border-transparent hover:border-input"}`}
                        >
                          <img src={thumbUrl(asset.id)} alt={asset.name} className="size-full object-cover" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted">Likes and comments on the old post are lost.</p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </Dialog>
  );
}

type RemovalTarget = { id: string; channel: string; live: boolean; note: string };

/** Removal for all or chosen Deliveries, saying per network whether it is permanent. */
export function RemoveDialogButton({
  postId,
  deliveries,
  label,
  small = false,
  hidden = false,
}: {
  postId: string;
  deliveries: RemovalTarget[];
  label: string;
  small?: boolean;
  /** Hides the button but stays mounted, so an open report survives the Delivery being removed. */
  hidden?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(deliveries.map((d) => d.id));
  const [reports, setReports] = useState<RemovalReport[] | null>(null);
  const [pending, startTransition] = useTransition();
  const single = deliveries.length === 1;

  const close = () => {
    setOpen(false);
    setReports(null);
    setChosen(deliveries.map((d) => d.id));
    router.refresh();
  };

  return (
    <>
      {hidden ? null : (
        <button type="button" className={small ? buttonClass.smallDanger : buttonClass.danger} onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      {open ? (
        <Dialog
          title={single ? `${deliveries[0].live ? "Remove from" : "Cancel for"} ${deliveries[0].channel}?` : "Remove this Post"}
          description={single ? deliveries[0].note : "Choose the Channels to remove it from. Each one is removed on its own."}
          onClose={close}
          footer={
            reports ? (
              <button type="button" className={buttonClass.primary} onClick={close}>
                Done
              </button>
            ) : (
              <>
                <button type="button" className={buttonClass.secondary} onClick={close}>
                  Keep
                </button>
                <button
                  type="button"
                  className={buttonClass.dangerFill}
                  disabled={pending || chosen.length === 0}
                  onClick={() => startTransition(async () => setReports(await removeAction(postId, chosen)))}
                >
                  {pending ? "Removing…" : single ? (deliveries[0].live ? "Remove" : "Cancel Delivery") : `Remove from ${chosen.length}`}
                </button>
              </>
            )
          }
        >
          {reports ? (
            <ul className="flex flex-col gap-2">
              {reports.map((report) => (
                <li key={report.deliveryId} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={`mt-1 size-1.5 shrink-0 rounded-full ${report.ok ? "bg-parrot" : "bg-danger"}`} />
                  <span>
                    <span className="font-medium">{report.channel}:</span>{" "}
                    <span className={report.ok ? "text-muted" : "text-danger"}>{report.ok ? report.message : `Not removed. ${report.message}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : single ? null : (
            <ul className="flex flex-col gap-2">
              {deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[#b8ff2c]"
                      checked={chosen.includes(delivery.id)}
                      onChange={(event) =>
                        setChosen((current) =>
                          event.target.checked ? [...current, delivery.id] : current.filter((id) => id !== delivery.id),
                        )
                      }
                    />
                    <span>
                      <span className="block text-base font-medium">{delivery.channel}</span>
                      <span className="block text-xs text-muted">{delivery.note}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
