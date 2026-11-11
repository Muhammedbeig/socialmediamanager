"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Capabilities } from "@/connectors/types";
import type { DeliveryStatus } from "@/db/schema";
import { captionLength } from "@/domain/checks";
import type { RemovalReport } from "@/deliveries/manage";
import { Dialog } from "@/ui/dialog";
import { Notice, buttonClass, textareaClass } from "@/ui/primitives";
import { type ActionResult, editAction, removeAction, replaceAction, retryAction } from "./actions";

type DeliveryView = {
  id: string;
  status: DeliveryStatus;
  channel: string;
  text: string;
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

  const removal = {
    id: delivery.id,
    channel: delivery.channel,
    live: delivery.status === "published",
    note: delivery.status === "published" ? delivery.removalNote : "Not live yet: it will be cancelled.",
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {delivery.status === "failed" ? (
          <button type="button" className={buttonClass.smallPrimary} disabled={pending} onClick={() => run(() => retryAction(postId, delivery.id))}>
            Retry
          </button>
        ) : null}
        {delivery.status === "published" ? (
          <button
            type="button"
            className={buttonClass.smallSecondary}
            disabled={pending}
            onClick={() => setTextMode(delivery.canEdit ? "edit" : "replace")}
          >
            {delivery.canEdit ? "Edit" : "Replace…"}
          </button>
        ) : null}
        {delivery.status === "published" || delivery.status === "scheduled" || delivery.status === "failed" ? (
          <RemoveDialogButton
            postId={postId}
            deliveries={[removal]}
            label={delivery.status === "published" ? "Remove…" : "Cancel…"}
            small
          />
        ) : null}
      </div>
      {error ? <p className="max-w-64 text-right text-xs text-danger">{error}</p> : null}

      {textMode ? (
        <TextDialog
          mode={textMode}
          delivery={delivery}
          onClose={() => setTextMode(null)}
          onSubmit={async (text) => {
            const result =
              textMode === "edit" ? await editAction(postId, delivery.id, text) : await replaceAction(postId, delivery.id, text);
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
  onSubmit: (text: string) => Promise<ActionResult>;
}) {
  const [text, setText] = useState(delivery.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rules = delivery.captionRules;
  const length = rules ? captionLength(text, rules) : text.length;
  const tooLong = rules ? length > rules.maxChars : false;

  return (
    <Dialog
      title={mode === "edit" ? `Edit text on ${delivery.channel}` : `Replace on ${delivery.channel}?`}
      description={
        mode === "edit"
          ? "The text changes in place on the network. Media cannot change."
          : `${delivery.editNote} Replace removes the live post and publishes a new one with this text.`
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {mode === "edit" ? "Cancel" : "Keep as is"}
          </button>
          <button
            type="button"
            className={mode === "edit" ? buttonClass.primary : buttonClass.dangerFill}
            disabled={pending || tooLong || text.trim().length === 0 || (mode === "edit" && text === delivery.text)}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await onSubmit(text);
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
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={7} className={textareaClass} />
      </label>
      {mode === "replace" ? (
        <p className="mt-3 text-xs text-muted">Likes and comments on the old post are lost.</p>
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
}: {
  postId: string;
  deliveries: RemovalTarget[];
  label: string;
  small?: boolean;
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
      <button type="button" className={small ? buttonClass.smallDanger : buttonClass.danger} onClick={() => setOpen(true)}>
        {label}
      </button>
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
